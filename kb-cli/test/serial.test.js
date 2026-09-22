"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MockBinding } = require("@serialport/binding-mock");
const { SerialPortStream } = require("@serialport/stream");
const { createSerialClient, parseJsonObjects } = require("../src/serial");
const {
  makeSegments,
  presetCommand,
  profileToCommands,
  stringToMacroCommand,
} = require("../src/protocol");

function createMockBinding() {
  MockBinding.reset();
  const instances = [];
  class MockSerialPort extends SerialPortStream {
    constructor(options, callback) {
      super({ ...options, binding: MockBinding }, callback);
      instances.push(this);
    }
  }
  MockSerialPort.list = MockBinding.list;
  return { MockSerialPort, instances };
}

const FAST_SERIAL_OPTS = {
  openSettleMs: 0,
  segmentDelayMs: 0,
  settleMs: 0,
  transport: "serial",
};

function createFlakyWriteBinding() {
  const writes = [];
  const instances = [];
  let firstWrite = true;
  class FlakySerialPort {
    constructor(options) {
      this.path = options.path;
      this.baudRate = options.baudRate;
      this.isOpen = false;
      instances.push(this);
    }

    static async list() {
      return [{ path: "/dev/free2", vendorId: "4C4A", productId: "4155" }];
    }

    on() {}

    open(callback) {
      this.isOpen = true;
      callback();
    }

    close(callback) {
      this.isOpen = false;
      callback();
    }

    write(data, callback) {
      if (firstWrite) {
        firstWrite = false;
        const error = new Error("no such device or address");
        error.code = "ENXIO";
        callback(error);
        return;
      }
      writes.push(Buffer.from(data));
      callback();
    }

    drain(callback) {
      callback();
    }
  }
  return { FlakySerialPort, writes, instances };
}

function createFlakyOpenBinding() {
  const writes = [];
  const instances = [];
  let firstOpen = true;
  class FlakyOpenSerialPort {
    constructor(options) {
      this.path = options.path;
      this.baudRate = options.baudRate;
      this.isOpen = false;
      instances.push(this);
    }

    static async list() {
      return [{ path: "/dev/free2", vendorId: "4C4A", productId: "4155" }];
    }

    on() {}

    open(callback) {
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

    close(callback) {
      this.isOpen = false;
      callback();
    }

    write(data, callback) {
      writes.push(Buffer.from(data));
      callback();
    }

    drain(callback) {
      callback();
    }
  }
  return { FlakyOpenSerialPort, writes, instances };
}

test("parses adjacent JSON objects from serial data", () => {
  const parsed = parseJsonObjects(
    'noise{"o":"getresult","t":"model","v":"Free2"}{"o":"x"}tail',
  );
  assert.deepEqual(parsed.objects, [
    { o: "getresult", t: "model", v: "Free2" },
    { o: "x" },
  ]);
  assert.equal(parsed.rest, "");
});

test("lists matching ports only", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/free2", { vendorId: "4C4A", productId: "4155" });
  MockBinding.createPort("/dev/other", { vendorId: "1234", productId: "5678" });

  const client = createSerialClient({ Binding: MockSerialPort });
  const ports = await client.listPorts();
  assert.deepEqual(
    ports.map((port) => port.path),
    ["/dev/free2"],
  );
});

test("lists Jieli usbmodem port when USB IDs are missing", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/tty.usbmodem1", {
    manufacturer: "Jieli Technology",
  });
  MockBinding.createPort("/dev/tty.Bluetooth-Incoming-Port", {});

  const client = createSerialClient({ Binding: MockSerialPort });
  const ports = await client.listPorts();

  assert.deepEqual(
    ports.map((port) => port.path),
    ["/dev/tty.usbmodem1"],
  );
});

test("does not match unrelated usbmodem ports without IDs or Jieli manufacturer", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/tty.usbmodem9", { manufacturer: "Other" });

  const client = createSerialClient({ Binding: MockSerialPort });
  const ports = await client.listPorts();

  assert.deepEqual(ports, []);
});

test("prefers macOS cu device path for outgoing serial connections", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/tty.usbmodem1", {
    vendorId: "4C4A",
    productId: "4155",
  });

  const client = createSerialClient({
    Binding: MockSerialPort,
    pathExists: (candidate) => candidate === "/dev/cu.usbmodem1",
  });

  assert.equal(
    await client.findPort("/dev/tty.usbmodem1"),
    "/dev/cu.usbmodem1",
  );
});

test("auto-detects the single matching port", async () => {
  const { MockSerialPort } = createMockBinding();
  MockBinding.createPort("/dev/free2", { vendorId: "4C4A", productId: "4155" });

  const client = createSerialClient({ Binding: MockSerialPort });

  assert.equal(await client.findPort(), "/dev/free2");
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

  assert.equal(
    instances[0].port.lastWrite.toString("utf8"),
    '{"o":"get","t":"model"}',
  );
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

  assert.equal(
    instances[0].port.lastWrite.toString("utf8"),
    '{"o":"set","m":"preset","v":"keyboard_lr"}',
  );
});

test("apply-style command list writes commands in order", async () => {
  const { MockSerialPort, instances } = createMockBinding();
  MockBinding.createPort("/dev/free2", {
    vendorId: "4C4A",
    productId: "4155",
    record: true,
  });
  const client = createSerialClient({ Binding: MockSerialPort });
  const commands = profileToCommands({
    model: "Free2",
    keys: [
      { key: 1, layer: "click", type: "phone", action: "home" },
      { key: 2, layer: "click", type: "phone", action: "swipe_up" },
    ],
  });

  await client.sendCommands(commands, FAST_SERIAL_OPTS);

  assert.equal(
    instances[0].port.recording.toString("utf8"),
    [
      '{"o":"set","k":1,"m":"mouse","e":"click","v":"home","r":1}',
      '{"o":"set","k":2,"m":"mouse","e":"click","v":"slideup","r":1}',
    ].join(""),
  );
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
  assert.equal(instances[0].port.recording.toString("utf8"), expected);
  assert.match(expected, /"k":2/);
  assert.match(expected, /"k":"\["/);
  assert.match(expected, /"k":"e"/);
  assert.match(expected, /"k":"q"/);
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

  assert.equal(instances.length, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].toString("utf8"), '{"o":"get","t":"model"}');
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

  assert.equal(instances.length, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].toString("utf8"), '{"o":"get","t":"model"}');
});
