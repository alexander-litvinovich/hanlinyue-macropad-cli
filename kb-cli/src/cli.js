#!/usr/bin/env node
"use strict";

const { Command } = require("commander");
const {
  PRESETS,
  infoCommands,
  loadProfile,
  presetCommand,
  profileToCommands,
  stringToMacroCommand,
  stringToTypeCommands,
} = require("./protocol");
const {
  DEFAULT_BAUD_RATE,
  DEFAULT_PRODUCT_ID,
  DEFAULT_VENDOR_ID,
  createSerialClient,
} = require("./serial");

async function main(argv = process.argv) {
  const program = new Command();
  program
    .name("hanlinyue-free2")
    .description("Program a Hanlinyue Free2 macro keyboard over USB serial.")
    .version("0.1.0")
    .option("--port <path>", "serial port path")
    .option("--vid <hex>", "USB vendor ID", DEFAULT_VENDOR_ID)
    .option("--pid <hex>", "USB product ID", DEFAULT_PRODUCT_ID)
    .option("--baud <rate>", "serial baud rate", String(DEFAULT_BAUD_RATE));

  program
    .command("list")
    .description("List Hanlinyue Free2 serial ports.")
    .option("--all", "show all serial ports")
    .action(async (options) => {
      const client = buildClient(program);
      const ports = await client.listPorts({ all: options.all });
      if (ports.length === 0) {
        console.log("No matching serial ports found.");
        return;
      }
      for (const port of ports) {
        console.log(formatPort(port));
      }
    });

  program
    .command("info")
    .description("Read model, battery, firmware, and MAC info.")
    .option("--timeout <ms>", "read timeout after writes", "1200")
    .action(async (options) => {
      const client = buildClient(program);
      const messages = await client.requestInfo(infoCommands(), {
        port: program.opts().port,
        timeoutMs: Number(options.timeout),
      });
      if (messages.length === 0) {
        console.log("No response received.");
        return;
      }
      for (const msg of messages) {
        if (msg.o === "getresult" && msg.t) {
          console.log(`${msg.t}: ${msg.v}`);
        } else {
          console.log(JSON.stringify(msg));
        }
      }
    });

  program
    .command("preset <name>")
    .description(`Apply a Free2 preset: ${Array.from(PRESETS).join(", ")}`)
    .action(async (name) => {
      const client = buildClient(program);
      await client.sendCommand(presetCommand(name), {
        port: program.opts().port,
      });
      console.log(`Preset applied: ${name}`);
    });

  program
    .command("apply <profile>")
    .description("Apply a YAML or JSON profile.")
    .action(async (profilePath) => {
      const client = buildClient(program);
      const profile = loadProfile(profilePath);
      const commands = profileToCommands(profile);
      const results = await client.sendCommands(commands, {
        port: program.opts().port,
      });
      console.log(`Applied ${results.length} command(s).`);
    });

  program
    .command("macro")
    .description("Write a macro from a plain text string.")
    .requiredOption("-k, --key <1|2>", "target key number")
    .requiredOption("-m, --macro <text>", "macro text to type")
    .option(
      "-d, --delay <ms>",
      "delay between key down and key up events",
      "30",
    )
    .option("--repeat <n|forever>", "macro repeat count", "1")
    .option(
      "--layer <layer>",
      "target layer: click, doubleclick, or longpress",
      "click",
    )
    .action(async (options) => {
      const client = buildClient(program);
      const command = stringToMacroCommand(options.macro, {
        key: options.key,
        delay: options.delay,
        repeat: options.repeat,
        layer: options.layer,
      });
      await client.sendCommand(command, { port: program.opts().port });
      console.log(
        `Macro written to key ${command.k}: ${Array.from(options.macro).length} character(s), delay ${Number(options.delay)} ms`,
      );
    });

  program
    .command("type <text>")
    .description(
      "Type a string across both keys (splits to fit 5-press limit, optimizes shift).",
    )
    .option(
      "-d, --delay <ms>",
      "delay between key down and key up events",
      "30",
    )
    .option("--repeat <n|forever>", "macro repeat count", "1")
    .option(
      "--layer <layer>",
      "target layer: click, doubleclick, or longpress",
      "click",
    )
    .action(async (text, options) => {
      const client = buildClient(program);
      const commands = stringToTypeCommands(text, {
        delay: options.delay,
        repeat: options.repeat,
        layer: options.layer,
      });
      const results = await client.sendCommands(commands, {
        port: program.opts().port,
      });
      const chars = Array.from(text);
      const key1Count = commands[0]
        ? commands[0].v.filter((e) => e.t === "down" && e.k !== "Shift").length
        : 0;
      const key2Count = commands[1]
        ? commands[1].v.filter((e) => e.t === "down" && e.k !== "Shift").length
        : 0;
      console.log(
        `Type: ${chars.length} char(s) across ${results.length} key(s) — ` +
          `key1: "${chars.slice(0, key1Count).join("")}", ` +
          `key2: "${chars.slice(key1Count).join("")}"`,
      );
    });

  program
    .command("raw <json>")
    .description("Send a raw JSON command.")
    .action(async (json) => {
      const client = buildClient(program);
      await client.sendCommand(JSON.parse(json), { port: program.opts().port });
      console.log("Raw command sent.");
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

function buildClient(program) {
  const options = program.opts();
  return createSerialClient({
    vendorId: options.vid,
    productId: options.pid,
    baudRate: Number(options.baud),
  });
}

function formatPort(port) {
  const details = [
    port.path,
    `VID=${port.vendorId || "-"}`,
    `PID=${port.productId || "-"}`,
    `manufacturer=${port.manufacturer || "-"}`,
  ];
  return details.join(" ");
}

if (require.main === module) {
  main().then(() => {
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 3000).unref();
  });
}

module.exports = {
  main,
  formatPort,
};
