import readline from "node:readline";
import { keyCountForModel, stringToTypeCommands } from "./commands";
import {
	fieldCapacity,
	MAX_CHARS_PER_KEY,
	MAX_EVENTS_PER_KEY,
	textToKeyPlan,
} from "./keymap";
import type { createSerialClient } from "./serial";

const RESET = "\x1b[0m";
const BRIGHT_GREEN = "\x1b[92m";
const BRIGHT_GREY = "\x1b[90m";
const WHITE = "\x1b[97m";
const RED = "\x1b[91m";
const INPUT_LABEL = "Set new text:  ";
const DISCONNECTED = "Macropad not connected.";

type SerialClient = ReturnType<typeof createSerialClient>;
type DeviceInfo = { model: string; battery: string };
type InfoPanelOptions = DeviceInfo & {
	keyCount: number;
	version: string;
	connected: boolean;
};
type Connection = { connected: boolean; path?: string };

type EditorOptions = {
	client: SerialClient;
	connection: Connection;
	device: DeviceInfo;
	keyCount: number;
	port?: string;
	version: string;
};

type InteractiveOptions = {
	client: SerialClient;
	model?: string;
	port?: string;
	version?: string;
};

async function runInteractive(options: InteractiveOptions): Promise<void> {
	const connection = await probeConnection(options.client, options.port);
	const device = connection.connected
		? await resolveDeviceInfo(options.client, options.model, options.port)
		: { model: options.model || "Free2", battery: "unknown" };
	const keyCount = keyCountForModel(device.model);
	const text = await editText({
		client: options.client,
		connection,
		device,
		keyCount,
		port: options.port,
		version: options.version || "0.1.0",
	});
	const commands = stringToTypeCommands(text, { keyCount });

	await options.client.sendCommands(commands, { port: options.port });
	console.log(
		`Wrote "${text}" across ${commands.length} key(s) on ${device.model}.`,
	);
}

async function probeConnection(
	client: SerialClient,
	port: string | undefined,
): Promise<Connection> {
	if (port) {
		return { connected: true, path: port };
	}
	try {
		const ports = await client.listPorts();
		return ports.length > 0
			? { connected: true, path: ports[0].path }
			: { connected: false };
	} catch {
		return { connected: false };
	}
}

async function resolveDeviceInfo(
	client: SerialClient,
	override: string | undefined,
	port: string | undefined,
): Promise<DeviceInfo> {
	if (override) {
		keyCountForModel(override);
	}

	try {
		const responses = await client.requestInfo(
			[
				{ o: "get", t: "model" },
				{ o: "get", t: "battery" },
			],
			{ port, timeoutMs: 400 },
		);
		const valueFor = (type: string) =>
			responses.find((item) => item.o === "getresult" && item.t === type)?.v;
		const detectedModel = valueFor("model");
		const model =
			override || (typeof detectedModel === "string" ? detectedModel : "Free2");
		keyCountForModel(model);
		const battery = valueFor("battery");
		return {
			model,
			battery: battery === undefined ? "unknown" : `${battery}%`,
		};
	} catch {
		return { model: override || "Free2", battery: "unknown" };
	}
}

function buildDeviceDrawing(keyCount: number): string[] {
	const cells = Array.from({ length: keyCount }, (_, index) =>
		String(keyCount - index)
			.padStart(4)
			.padEnd(7),
	);
	const gridTop = `┌${Array(keyCount).fill("───────").join("┬")}┐`;
	const gridMiddle = `├${Array(keyCount).fill("───────").join("┼")}┤`;
	const bodyWidth = 8 * keyCount + 3;

	return [
		`      ${gridTop}`,
		`    ┌─│${cells.join("│")}│─┐`,
		` ╭──┤ ${gridMiddle} │`,
		` │  ├${"─".repeat(bodyWidth)}┤`,
		` ╰──┤${" ".repeat(bodyWidth)}│`,
		`    └${"─".repeat(bodyWidth)}┘`,
	];
}

function buildInfoPanel(options: InfoPanelOptions): string[] {
	const content = [
		`Macropad Configurator v.${options.version}`,
		options.connected
			? `Model: ${options.model}, ${options.keyCount} keys, ${MAX_EVENTS_PER_KEY} events each`
			: "Model: disconnected",
		`Battery: ${options.connected ? options.battery : "disconnected"}`,
	];
	const width = Math.max(...content.map((line) => line.length));
	return [
		`┌${"─".repeat(width + 2)}┐`,
		...content.map((line) => `│ ${line.padEnd(width)} │`),
		`└${"─".repeat(width + 2)}┘`,
	];
}

function renderInfoPanel(lines: string[]): string[] {
	return lines.map((line) => {
		if (line.startsWith("│")) {
			return `${BRIGHT_GREY}│${WHITE}${line.slice(1, -1)}${BRIGHT_GREY}│${RESET}`;
		}
		return `${BRIGHT_GREY}${line}${RESET}`;
	});
}

function renderHeader(options: InfoPanelOptions): string[] {
	const device = buildDeviceDrawing(options.keyCount);
	const panel = renderInfoPanel(buildInfoPanel(options));
	const deviceColor = options.connected ? BRIGHT_GREEN : BRIGHT_GREY;
	const gap = "  ";
	return device.map((line, index) => {
		const coloredDevice = `${deviceColor}${line}${RESET}`;
		const panelLine = panel[index - 1];
		return panelLine ? `${coloredDevice}${gap}${panelLine}` : coloredDevice;
	});
}

function validationMessage(
	error: string,
	message: string,
	hasEnteredText: boolean,
): string {
	return error || (hasEnteredText ? message : "");
}

function editText(options: EditorOptions): Promise<string> {
	const { client, device, keyCount, port, version } = options;
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return Promise.reject(
			new Error(
				"Interactive mode requires a terminal. Use `type <text>` in scripts.",
			),
		);
	}

	return new Promise((resolve, reject) => {
		let text = "";
		let cursor = 0;
		let error = "";
		let hasEnteredText = false;
		let confirming = false;
		let connection = options.connection;

		const finish = (result?: string, reason?: Error) => {
			clearInterval(poll);
			process.stdin.setRawMode(false);
			process.stdin.pause();
			process.stdout.write("\x1b[0 q\x1b[?25h\x1b[0m\n");
			if (reason) {
				reject(reason);
			} else if (result !== undefined) {
				resolve(result);
			} else {
				reject(new Error("Cancelled."));
			}
		};

		const validation = () => {
			if (text.length === 0) {
				return {
					valid: false,
					message: "Enter at least one character.",
					usage: null,
				};
			}
			try {
				const usage = textToKeyPlan(text);
				if (usage.requiredKeys > keyCount) {
					return {
						valid: false,
						message: `Needs ${usage.requiredKeys} keys. ${device.model} has ${keyCount}.`,
						usage,
					};
				}
				return { valid: true, message: "", usage };
			} catch (cause) {
				return {
					valid: false,
					message: cause instanceof Error ? cause.message : String(cause),
					usage: null,
				};
			}
		};

		const render = () => {
			const result = validation();
			const usage = result.usage;
			const events = Array.from({ length: keyCount }, (_, index) => {
				const key = usage?.keys[index];
				if (key) {
					return `${key.events}/${MAX_EVENTS_PER_KEY}`;
				}
				return usage || text.length === 0
					? `0/${MAX_EVENTS_PER_KEY}`
					: `-/${MAX_EVENTS_PER_KEY}`;
			}).join(" + ");
			const status = confirming
				? { color: WHITE, text: "Write this text? [y/N]" }
				: !result.valid
					? {
							color: RED,
							text: validationMessage(
								error,
								result.message,
								hasEnteredText,
							),
						}
					: connection.connected
						? { color: WHITE, text: "Enter writes, Esc cancels." }
						: { color: RED, text: DISCONNECTED };
			const overflowing = Boolean(
				usage && usage.requiredKeys > keyCount,
			);
			const fieldChars = usage
				? fieldCapacity(text, keyCount)
				: keyCount * MAX_CHARS_PER_KEY;
			const underline = `              └${"─".repeat(fieldChars)}┘`;
			const underlineColor = overflowing ? RED : BRIGHT_GREY;
			const lines = [
				...renderHeader({
					...device,
					connected: connection.connected,
					keyCount,
					version,
				}),
				"",
				`${WHITE}${INPUT_LABEL}${text}${RESET}`,
				`${underlineColor}${underline}${RESET}`,
				`${WHITE}Events:        ${events}${RESET}`,
				"",
				`${status.color}${status.text}${RESET}`,
			];

			process.stdout.write(
				`\x1b[H${lines.map((line) => `${line}\x1b[K`).join("\n")}\n\x1b[J` +
					`\x1b[8;${INPUT_LABEL.length + cursor + 1}H`,
			);
		};

		// The port list is cheap, so watching it lets the panel react to a replug.
		const poll = setInterval(async () => {
			const next = await probeConnection(client, port);
			if (next.connected !== connection.connected) {
				connection = next;
				render();
			}
		}, 1000);
		poll.unref();

		readline.emitKeypressEvents(process.stdin);
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdout.write("\x1b[2J\x1b[1 q\x1b[?25h");
		render();

		process.stdin.on("keypress", (input, key) => {
			error = "";
			if (key.ctrl && key.name === "c") {
				finish(undefined, new Error("Cancelled."));
				return;
			}
			if (confirming) {
				if (input.toLowerCase() === "y") {
					finish(text);
					return;
				}
				confirming = false;
				render();
				return;
			}
			if (key.name === "escape") {
				finish(undefined, new Error("Cancelled."));
				return;
			}
			if (key.name === "return") {
				if (!validation().valid) {
					error = "Fix the text before writing.";
				} else if (!connection.connected) {
					error = DISCONNECTED;
				} else {
					confirming = true;
				}
			} else if (key.name === "backspace") {
				if (cursor > 0) {
					text = `${text.slice(0, cursor - 1)}${text.slice(cursor)}`;
					cursor -= 1;
				}
			} else if (key.name === "delete") {
				text = `${text.slice(0, cursor)}${text.slice(cursor + 1)}`;
			} else if (key.name === "left") {
				cursor = Math.max(0, cursor - 1);
			} else if (key.name === "right") {
				cursor = Math.min(text.length, cursor + 1);
			} else if (key.name === "home") {
				cursor = 0;
			} else if (key.name === "end") {
				cursor = text.length;
			} else if (input && !key.ctrl && !key.meta) {
				text = `${text.slice(0, cursor)}${input}${text.slice(cursor)}`;
				cursor += input.length;
				hasEnteredText = true;
			}
			render();
		});
	});
}

export {
	buildDeviceDrawing,
	buildInfoPanel,
	probeConnection,
	runInteractive,
	resolveDeviceInfo,
	validationMessage,
};
