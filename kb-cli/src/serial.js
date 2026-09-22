"use strict";

const fs = require("node:fs");
const { SerialPort } = require("serialport");
const { makeSegments } = require("./protocol");

const DEFAULT_VENDOR_ID = "4C4A";
const DEFAULT_PRODUCT_ID = "4155";
const DEFAULT_BAUD_RATE = 460800;

function normalizeHex(value) {
  return String(value || "")
    .replace(/^0x/i, "")
    .toUpperCase();
}

function createSerialClient(options = {}) {
  const Binding = options.Binding || SerialPort;
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

  function isMatchingPort(port) {
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

  async function findPort(explicitPath) {
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

  function preferConnectionPath(portPath) {
    if (process.platform !== "darwin" || !portPath.startsWith("/dev/tty.")) {
      return portPath;
    }
    const cuPath = portPath.replace("/dev/tty.", "/dev/cu.");
    return pathExists(cuPath) ? cuPath : portPath;
  }

  async function withPort(callback, opts = {}) {
    const retryCount = Number(opts.retries ?? 2);
    let lastError;

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

  async function sendCommand(command, opts = {}) {
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

  async function sendCommands(commands, opts = {}) {
    const allResults = [];

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

  async function requestInfo(commands, opts = {}) {
    const timeoutMs = Number(opts.timeoutMs || 1200);
    return withPort(async (port) => {
      const messages = [];
      let buffer = "";

      port.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const parsed = parseJsonObjects(buffer);
        buffer = parsed.rest;
        messages.push(...parsed.objects);
      });

      for (const command of commands) {
        const result = makeSegments(command, sequenceNumber);
        sequenceNumber = result.nextSequenceNumber;
        for (const segment of result.segments) {
          await writeData(port, segment);
          await delay(10);
        }
        await delay(100);
      }

      await delay(timeoutMs);
      return messages;
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

function open(port) {
  return new Promise((resolve, reject) => {
    port.open((error) => (error ? reject(error) : resolve()));
  });
}

function close(port) {
  return new Promise((resolve) => {
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

function writeData(port, data) {
  return new Promise((resolve, reject) => {
    const str = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
    port.write(str, (writeError) => {
      if (writeError) {
        reject(writeError);
        return;
      }
      const timeout = setTimeout(resolve, 200);
      port.drain((drainError) => {
        clearTimeout(timeout);
        drainError ? reject(drainError) : resolve();
      });
    });
  });
}

function isTransientSerialError(error) {
  if (["ENXIO", "ENOENT", "EIO"].includes(error && error.code)) {
    return true;
  }
  const message = String((error && error.message) || "").toLowerCase();
  return (
    message.includes("no such device") ||
    message.includes("no such file") ||
    message.includes("input/output error")
  );
}

function parseJsonObjects(input) {
  const objects = [];
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function warmup(port) {
  await writeData(port, '{"o":"get","t":"model"}');
  await delay(200);
}

module.exports = {
  DEFAULT_VENDOR_ID,
  DEFAULT_PRODUCT_ID,
  DEFAULT_BAUD_RATE,
  createSerialClient,
  parseJsonObjects,
};
