#!/usr/bin/env node

import { Command } from "commander";
import {
  PRESETS,
  infoCommands,
  keyCountForModel,
  presetCommand,
  stringToMacroCommand,
  stringToTypeCommands,
} from "./commands";
import { charCount, textToKeyPlan } from "./keymap";
import {
  DEFAULT_BAUD_RATE,
  DEFAULT_PRODUCT_ID,
  DEFAULT_VENDOR_ID,
  createSerialClient,
} from "./serial";
import { runInteractive } from "./tui";

const VERSION = "0.1.0";

type GlobalOptions = {
  port?: string;
  model?: string;
  vid: string;
  pid: string;
  baud: string;
};

type MacroOptions = {
  key: string;
  macro: string;
  delay: string;
  repeat: string;
  layer: string;
};

type TypeOptions = Omit<MacroOptions, "key" | "macro">;

async function main(argv = process.argv) {
  const program = new Command();
  program
    .name("macropad-cfg")
    .description("Set text to type on a Hanlinyue macro keyboard.")
    .version(VERSION)
    .option("--port <path>", "serial port path")
    .option("--model <Free2|Free3>", "override detected device model")
    .option("--vid <hex>", "USB vendor ID", DEFAULT_VENDOR_ID)
    .option("--pid <hex>", "USB product ID", DEFAULT_PRODUCT_ID)
    .option("--baud <rate>", "serial baud rate", String(DEFAULT_BAUD_RATE));

  program.action(async () => {
    const options = program.opts() as GlobalOptions;
    await runInteractive({
      client: buildClient(program),
      model: options.model,
      port: options.port,
      version: VERSION,
    });
  });

  program
    .command("list")
    .description("List Hanlinyue Free2 serial ports.")
    .option("--all", "show all serial ports")
    .action(async (options: { all?: boolean }) => {
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
    .action(async (options: { timeout: string }) => {
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
    .action(async (name: string) => {
      const client = buildClient(program);
      await client.sendCommand(presetCommand(name), {
        port: program.opts().port,
      });
      console.log(`Preset applied: ${name}`);
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
    .action(async (options: MacroOptions) => {
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
      "Type a string across the device keys within the 15-event limit.",
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
    .action(async (text: string, options: TypeOptions) => {
      const client = buildClient(program);
      const keyCount = keyCountForModel(program.opts().model || "Free2");
      const plan = textToKeyPlan(text, keyCount);
      const commands = stringToTypeCommands(text, {
        delay: options.delay,
        repeat: options.repeat,
        layer: options.layer,
        keyCount,
      });
      const results = await client.sendCommands(commands, {
        port: program.opts().port,
      });
      console.log(
        `Type: ${charCount(text)} char(s) across ${results.length} key(s) — ` +
          plan.keys.map((key) => `key${key.key}: "${key.text}"`).join(", "),
      );
    });

  program
    .command("raw <json>")
    .description("Send a raw JSON command.")
    .action(async (json: string) => {
      const client = buildClient(program);
      await client.sendCommand(JSON.parse(json), { port: program.opts().port });
      console.log("Raw command sent.");
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function buildClient(program: Command) {
  const options = program.opts() as GlobalOptions;
  return createSerialClient({
    vendorId: options.vid,
    productId: options.pid,
    baudRate: Number(options.baud),
  });
}

function formatPort(port: {
  path: string;
  vendorId?: string;
  productId?: string;
  manufacturer?: string;
}) {
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

export {
  main,
  formatPort,
};
