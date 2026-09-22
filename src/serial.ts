export interface PortInfoLike {
  path: string;
  vendorId?: string;
  productId?: string;
  manufacturer?: string;
}

export interface SerialPortLike {
  isOpen: boolean;
  on(event: string, cb: (chunk: Buffer) => void): void;
  open(cb: (error?: Error | null) => void): void;
  close(cb: (error?: Error | null) => void): void;
  write(data: string, cb: (error?: Error | null) => void): void;
  drain(cb: (error?: Error | null) => void): void;
}

export interface SerialPortLikeCtor {
  new (options: {
    path: string;
    baudRate: number;
    autoOpen: boolean;
  }): SerialPortLike;
  list(): Promise<PortInfoLike[]>;
}

type SerialClientOptions = {
  Binding?: SerialPortLikeCtor;
  vendorId?: string;
  productId?: string;
  baudRate?: number;
  pathExists?: (path: string) => boolean;
};

type SendOptions = {
  port?: string;
  retries?: number;
  openSettleMs?: number;
  retryDelayMs?: number;
  settleMs?: number;
  timeoutMs?: number;
};

type Command = Record<string, unknown>;

import fs from "node:fs";
import { SerialPort } from "serialport";
import { makeSegments } from "./wire";

const DEFAULT_VENDOR_ID = "4C4A";
const DEFAULT_PRODUCT_ID = "4155";
const DEFAULT_BAUD_RATE = 460800;
const INFO_ATTEMPTS = 3;

function normalizeHex(value: unknown): string {
  return String(value || "")
    .replace(/^0x/i, "")
    .toUpperCase();
}

function createSerialClient(options: SerialClientOptions = {}) {
  const Binding: SerialPortLikeCtor =
    options.Binding || (SerialPort as unknown as SerialPortLikeCtor);
  const vendorId = normalizeHex(options.vendorId || DEFAULT_VENDOR_ID);
  const productId = normalizeHex(options.productId || DEFAULT_PRODUCT_ID);
  const baudRate = Number(options.baudRate || DEFAULT_BAUD_RATE);
  const pathExists = options.pathExists || fs.existsSync;
  let sequenceNumber = 1;

  async function listPorts({ all = false } = {}) {
    const ports = await Binding.list();
    if (all) {
      return ports;
    }
    return ports.filter(isMatchingPort);
  }

  function isMatchingPort(port: PortInfoLike) {
    const matchesUsbId =
      normalizeHex(port.vendorId) === vendorId &&
      normalizeHex(port.productId) === productId;
    if (matchesUsbId) {
      return true;
    }

    const manufacturer = String(port.manufacturer || "").toLowerCase();
    const portPath = String(port.path || "").toLowerCase();
    return manufacturer.includes("jieli") && portPath.includes("usbmodem");
  }

  async function findPort(explicitPath?: string): Promise<string> {
    if (explicitPath) {
      return preferConnectionPath(explicitPath);
    }
    const ports = await listPorts();
    if (ports.length === 0) {
      throw new Error(
        `No Hanlinyue Free2 serial port found for VID=${vendorId}, PID=${productId}.`,
      );
    }
    if (ports.length > 1) {
      const paths = ports.map((port) => port.path).join(", ");
      throw new Error(
        `Multiple matching ports found (${paths}). Pass --port <path>.`,
      );
    }
    return preferConnectionPath(ports[0].path);
  }

  function preferConnectionPath(portPath: string): string {
    if (process.platform !== "darwin" || !portPath.startsWith("/dev/tty.")) {
      return portPath;
    }
    const cuPath = portPath.replace("/dev/tty.", "/dev/cu.");
    return pathExists(cuPath) ? cuPath : portPath;
  }

  async function withPort<T>(
    callback: (port: SerialPortLike) => Promise<T>,
    opts: SendOptions = {},
  ): Promise<T> {
    const retryCount = Number(opts.retries ?? 2);
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const portPath = await findPort(opts.port);
      const port = new Binding({
        path: portPath,
        baudRate,
        autoOpen: false,
      });
      port.on("error", () => {
        // Errors are surfaced through open/write callbacks; keep EventEmitter from crashing the CLI.
      });

      try {
        await open(port);
        await delay(Number(opts.openSettleMs ?? 100));
        return await callback(port);
      } catch (error) {
        lastError = error;
        if (!isTransientSerialError(error) || attempt === retryCount) {
          throw error;
        }
        await delay(Number(opts.retryDelayMs ?? 500));
      } finally {
        if (port.isOpen) {
          await close(port);
        }
      }
    }

    throw lastError;
  }

  async function sendCommand(command: Command, opts: SendOptions = {}) {
    const result = makeSegments(command, sequenceNumber);
    sequenceNumber = result.nextSequenceNumber;

    return withPort(async (port) => {
      if (result.segments.length > 1) {
        await warmup(port);
      }
      for (const segment of result.segments) {
        await writeData(port, segment);
        await delay(10);
      }
      await delay(Number(opts.settleMs ?? 300));
      return {
        status: "ok",
        segments: result.segments.length,
        transport: "serial",
      };
    }, opts);
  }

  async function sendCommands(commands: Command[], opts: SendOptions = {}) {
    const allResults: { command: Command; segments: number }[] = [];

    const prepared = commands.map((command) => {
      const result = makeSegments(command, sequenceNumber);
      sequenceNumber = result.nextSequenceNumber;
      allResults.push({ command, segments: result.segments.length });
      return result;
    });

    return withPort(async (port) => {
      const hasSegmented = prepared.some((r) => r.segments.length > 1);
      if (hasSegmented) {
        await warmup(port);
      }
      for (const result of prepared) {
        for (const segment of result.segments) {
          await writeData(port, segment);
          await delay(10);
        }
      }
      await delay(Number(opts.settleMs ?? 300));
      return allResults;
    }, opts);
  }

  async function requestInfo(commands: Command[], opts: SendOptions = {}) {
    const timeoutMs = Number(opts.timeoutMs || 1200);
    return withPort(async (port) => {
      const messages: Command[] = [];
      let buffer = "";

      port.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const parsed = parseJsonObjects(buffer);
        buffer = parsed.rest;
        messages.push(...parsed.objects);
      });

      const answered = () =>
        new Set(
          messages
            .filter((message) => message.o === "getresult")
            .map((message) => message.t),
        );

      // The device silently drops queries, especially right after a fresh port
      // open, so resend whatever has not been answered yet.
      for (let attempt = 0; attempt < INFO_ATTEMPTS; attempt += 1) {
        const pending = commands.filter(
          (command) => !answered().has(command.t),
        );
        if (pending.length === 0) {
          break;
        }
        for (const command of pending) {
          const result = makeSegments(command, sequenceNumber);
          sequenceNumber = result.nextSequenceNumber;
          for (const segment of result.segments) {
            await writeData(port, segment);
            await delay(10);
          }
          await delay(100);
        }
        await delay(timeoutMs);
      }

      return dedupeResults(messages);
    }, opts);
  }

  return {
    listPorts,
    findPort,
    sendCommand,
    sendCommands,
    requestInfo,
  };
}

function open(port: SerialPortLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    port.open((error?: Error | null) => (error ? reject(error) : resolve()));
  });
}

function close(port: SerialPortLike): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve();
      }
    }, 1000);
    port.close(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function writeData(port: SerialPortLike, data: Buffer | string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const str = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
    port.write(str, (writeError?: Error | null) => {
      if (writeError) {
        reject(writeError);
        return;
      }
      const timeout = setTimeout(resolve, 200);
      port.drain((drainError?: Error | null) => {
        clearTimeout(timeout);
        drainError ? reject(drainError) : resolve();
      });
    });
  });
}

function isTransientSerialError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: string }).code
      : undefined;
  if (["ENXIO", "ENOENT", "EIO"].includes(code || "")) {
    return true;
  }
  const message = String(
    error instanceof Error ? error.message : "",
  ).toLowerCase();
  return (
    message.includes("no such device") ||
    message.includes("no such file") ||
    message.includes("input/output error")
  );
}

function parseJsonObjects(input: string): { objects: Command[]; rest: string } {
  const objects: Command[] = [];
  let rest = input;

  while (true) {
    const start = rest.indexOf("{");
    if (start === -1) {
      return { objects, rest: "" };
    }
    if (start > 0) {
      rest = rest.slice(start);
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = 0; i < rest.length; i += 1) {
      const char = rest[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) {
      return { objects, rest };
    }

    const json = rest.slice(0, end + 1);
    objects.push(JSON.parse(json));
    rest = rest.slice(end + 1);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeResults(messages: Command[]): Command[] {
  const seen = new Set<unknown>();
  return messages.filter((message) => {
    if (message.o !== "getresult" || seen.has(message.t)) {
      return message.o !== "getresult";
    }
    seen.add(message.t);
    return true;
  });
}

async function warmup(port: SerialPortLike): Promise<void> {
  await writeData(port, '{"o":"get","t":"model"}');
  await delay(200);
}

export {
  DEFAULT_VENDOR_ID,
  DEFAULT_PRODUCT_ID,
  DEFAULT_BAUD_RATE,
  createSerialClient,
  parseJsonObjects,
};
