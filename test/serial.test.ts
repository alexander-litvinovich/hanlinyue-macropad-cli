"use strict";

import { expect, test } from "vitest";
import {
  createSerialClient,
  parseJsonObjects,
  type SerialPortLike,
  type SerialPortLikeCtor,
} from "../src/serial";
const { MockBinding } = require("@serialport/binding-mock");
const { SerialPortStream } = require("@serialport/stream");
import { presetCommand, stringToMacroCommand } from "../src/commands";
import { makeSegments } from "../src/wire";

function createMockBinding() {
  MockBinding.reset();
  const instances: any[] = [];
  class MockSerialPort extends SerialPortStream {
    static list = MockBinding.list;

    constructor(options: any, callback?: any) {
      super({ ...options, binding: MockBinding }, callback);
      instances.push(this);
    }
  }
  return {
    MockSerialPort: MockSerialPort as unknown as SerialPortLikeCtor,
    instances,
  };
}

const FAST_SERIAL_OPTS = {
  openSettleMs: 0,
  segmentDelayMs: 0,
  settleMs: 0,
  transport: "serial",
};

function createFlakyWriteBinding() {
  const writes: Buffer[] = [];
  const instances: FlakySerialPort[] = [];
  let firstWrite = true;
  class FlakySerialPort implements SerialPortLike {
    path: string;
    baudRate: number;
    isOpen = false;

    constructor(options: { path: string; baudRate: number }) {
      this.path = options.path;
      this.baudRate = options.baudRate;
      this.isOpen = false;
      instances.push(this);
    }

    static async list() {
      return [{ path: "/dev/free2", vendorId: "4C4A", productId: "4155" }];
    }

    on(_event: string, _callback: (...args: any[]) => void) {}

    open(callback: (error?: Error | null) => void) {
      this.isOpen = true;
      callback();
    }

    close(callback: (error?: Error | null) => void) {
      this.isOpen = false;
      callback();
    }

    write(data: string, callback: (error?: Error | null) => void) {
      if (firstWrite) {
        firstWrite = false;
        const error = Object.assign(new Error("no such device or address"), {
          code: "ENXIO",
        });
        callback(error);
        return;
      }
      writes.push(Buffer.from(data));
      callback();
    }

    drain(callback: (error?: Error | null) => void) {
      callback();
    }
  }
  return { FlakySerialPort, writes, instances };
}

function createFlakyOpenBinding() {
  const writes: Buffer[] = [];
  const instances: FlakyOpenSerialPort[] = [];
  let firstOpen = true;
  class FlakyOpenSerialPort implements SerialPortLike {
    path: string;
    baudRate: number;
    isOpen = false;

    constructor(options: { path: string; baudRate: number }) {
      this.path = options.path;
      this.baudRate = options.baudRate;
      this.isOpen = false;
      instances.push(this);
    }

    static async list() {
      return [{ path: "/dev/free2", vendorId: "4C4A", productId: "4155" }];
    }

    on(_event: string, _callback: (...args: any[]) => void) {}

    open(callback: (error?: Error | null) => void) {
      if (firstOpen) {
        firstOpen = false;
        callback(
          new Error("No such file or directory, cannot open /dev/free2"),
        );
        return;
      }
      this.isOpen = true;
      callback();
    }

    close(callback: (error?: Error | null) => void) {
      this.isOpen = false;
      callback();
    }

    write(data: string, callback: (error?: Error | null) => void) {
      writes.push(Buffer.from(data));
      callback();
    }

    drain(callback: (error?: Error | null) => void) {
      callback();
    }
  }
  return { FlakyOpenSerialPort, writes, instances };
}

test("parses adjacent JSON objects from serial data", () => {
  const parsed = parseJsonObjects(
    'noise{"o":"getresult","t":"model","v":"Free2"}{"o":"x"}tail',
  );
  expect(parsed.objects).toEqual([
    { o: "getresult", t: "model", v: "Free2" },
    { o: "x" },
  ]);
  expect(parsed.rest).toBe("");
});

test("lists matching ports only", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/free2", { vendorId: "4C4A", productId: "4155" });
  MockBinding.createPort("/dev/other", { vendorId: "1234", productId: "5678" });

  const client = createSerialClient({ Binding: MockSerialPort });
  const ports = await client.listPorts();
  expect(ports.map((port: any) => port.path)).toEqual(["/dev/free2"],);
});

test("lists Jieli usbmodem port when USB IDs are missing", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/tty.usbmodem1", {
    manufacturer: "Jieli Technology",
  });
  MockBinding.createPort("/dev/tty.Bluetooth-Incoming-Port", {});

  const client = createSerialClient({ Binding: MockSerialPort });
  const ports = await client.listPorts();

  expect(ports.map((port: any) => port.path)).toEqual(["/dev/tty.usbmodem1"],);
});

test("does not match unrelated usbmodem ports without IDs or Jieli manufacturer", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/tty.usbmodem9", { manufacturer: "Other" });

  const client = createSerialClient({ Binding: MockSerialPort });
  const ports = await client.listPorts();

  expect(ports).toEqual([]);
});

test("prefers macOS cu device path for outgoing serial connections", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/tty.usbmodem1", {
    vendorId: "4C4A",
    productId: "4155",
  });

  const client = createSerialClient({
    Binding: MockSerialPort,
    pathExists: (candidate: string) => candidate === "/dev/cu.usbmodem1",
  });

  expect(await client.findPort("/dev/tty.usbmodem1")).toBe("/dev/cu.usbmodem1",);
});

test("auto-detects the single matching port", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/free2", { vendorId: "4C4A", productId: "4155" });

  const client = createSerialClient({ Binding: MockSerialPort });

  expect(await client.findPort()).toBe("/dev/free2");
});

test("raw command writes expected bytes to mock port", async () => {
  const { MockSerialPort, instances } = createMockBinding();
  MockBinding.createPort("/dev/free2", {
    vendorId: "4C4A",
    productId: "4155",
    record: true,
  });

  const client = createSerialClient({ Binding: MockSerialPort });
  await client.sendCommand({ o: "get", t: "model" }, FAST_SERIAL_OPTS);

  expect(instances[0].port.lastWrite.toString("utf8")).toBe('{"o":"get","t":"model"}',);
});

test("preset command writes expected bytes to mock port", async () => {
  const { MockSerialPort, instances } = createMockBinding();
  MockBinding.createPort("/dev/free2", {
    vendorId: "4C4A",
    productId: "4155",
    record: true,
  });

  const client = createSerialClient({ Binding: MockSerialPort });
  await client.sendCommand(presetCommand("keyboard_lr"), FAST_SERIAL_OPTS);

  expect(instances[0].port.lastWrite.toString("utf8")).toBe('{"o":"set","m":"preset","v":"keyboard_lr"}',);
});

test("plain text macro command writes expected bytes to mock port", async () => {
  const { MockSerialPort, instances } = createMockBinding();
  MockBinding.createPort("/dev/free2", {
    vendorId: "4C4A",
    productId: "4155",
    record: true,
  });

  const client = createSerialClient({ Binding: MockSerialPort });
  const command = stringToMacroCommand("[eq", { key: 2, delay: 30 });
  await client.sendCommand(command, FAST_SERIAL_OPTS);

  const warmup = '{"o":"get","t":"model"}';
  const expected =
    warmup + Buffer.concat(makeSegments(command, 1).segments).toString("utf8");
  expect(instances[0].port.recording.toString("utf8")).toBe(expected);
  expect(expected).toMatch(/"k":2/);
  expect(expected).toMatch(/"k":"\["/);
  expect(expected).toMatch(/"k":"e"/);
  expect(expected).toMatch(/"k":"q"/);
});

test("retries a transient ENXIO write by reopening the port", async () => {
  const { FlakySerialPort, writes, instances } = createFlakyWriteBinding();
  const client = createSerialClient({ Binding: FlakySerialPort });

  await client.sendCommand(
    { o: "get", t: "model" },
    {
      openSettleMs: 0,
      retryDelayMs: 0,
      settleMs: 0,
    },
  );

  expect(instances.length).toBe(2);
  expect(writes.length).toBe(1);
  expect(writes[0].toString("utf8")).toBe('{"o":"get","t":"model"}');
});

test("retries a transient open error by reopening the port", async () => {
  const { FlakyOpenSerialPort, writes, instances } = createFlakyOpenBinding();
  const client = createSerialClient({ Binding: FlakyOpenSerialPort });

  await client.sendCommand(
    { o: "get", t: "model" },
    {
      openSettleMs: 0,
      retryDelayMs: 0,
      settleMs: 0,
    },
  );

  expect(instances.length).toBe(2);
  expect(writes.length).toBe(1);
  expect(writes[0].toString("utf8")).toBe('{"o":"get","t":"model"}');
});
