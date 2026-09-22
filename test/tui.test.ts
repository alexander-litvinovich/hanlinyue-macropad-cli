import { expect, test } from "vitest";
import {
	buildDeviceDrawing,
	buildInfoPanel,
	probeConnection,
	validationMessage,
} from "../src/tui";

function stubClient(listPorts: () => Promise<{ path: string }[]>) {
	return { listPorts } as never;
}

test("draws the two-key macropad from the mockup", () => {
  expect(buildDeviceDrawing(2)).toEqual([
    "      ┌───────┬───────┐",
    "    ┌─│   2   │   1   │─┐",
    " ╭──┤ ├───────┼───────┤ │",
    " │  ├───────────────────┤",
    " ╰──┤                   │",
    "    └───────────────────┘",
  ]);
});

test("widens the device drawing for Free3", () => {
  expect(buildDeviceDrawing(3)).toEqual([
    "      ┌───────┬───────┬───────┐",
    "    ┌─│   3   │   2   │   1   │─┐",
    " ╭──┤ ├───────┼───────┼───────┤ │",
    " │  ├───────────────────────────┤",
    " ╰──┤                           │",
    "    └───────────────────────────┘",
  ]);
});

test("detects a connected macropad from the matching port list", async () => {
	const present = stubClient(async () => [{ path: "/dev/cu.usbmodem31303" }]);
	expect(await probeConnection(present, undefined)).toEqual({
		connected: true,
		path: "/dev/cu.usbmodem31303",
	});

	const absent = stubClient(async () => []);
	expect(await probeConnection(absent, undefined)).toEqual({ connected: false });
});

test("trusts an explicit port and survives a failing port list", async () => {
	const failing = stubClient(async () => {
		throw new Error("enumeration failed");
	});
	expect(await probeConnection(failing, "/dev/cu.custom")).toEqual({
		connected: true,
		path: "/dev/cu.custom",
	});
	expect(await probeConnection(failing, undefined)).toEqual({
		connected: false,
	});
});

test("sizes the info panel to its longest line", () => {
  const panel = buildInfoPanel({
    version: "0.1.0",
    model: "Free2",
    keyCount: 2,
    battery: "20/100%",
    connected: true,
  });

  expect(panel).toEqual([
    "┌──────────────────────────────────────┐",
		"│ Macropad Configurator v.0.1.0        │",
		"│ Model: Free2, 2 keys, 19 events each │",
    "│ Battery: 20/100%                     │",
    "└──────────────────────────────────────┘",
  ]);
});

test("reports a disconnected macropad instead of the assumed model", () => {
  const panel = buildInfoPanel({
    version: "0.1.0",
    model: "Free2",
    keyCount: 2,
    battery: "unknown",
    connected: false,
  });

  expect(panel).toEqual([
    "┌───────────────────────────────┐",
    "│ Macropad Configurator v.0.1.0 │",
    "│ Model: disconnected           │",
    "│ Battery: disconnected         │",
    "└───────────────────────────────┘",
  ]);
});

test("hides the empty-text validation message before text is entered", () => {
	expect(validationMessage("", "Enter at least one character.", false)).toBe("");
});

test("shows the empty-text validation message after text is cleared", () => {
	expect(validationMessage("", "Enter at least one character.", true)).toBe(
		"Enter at least one character.",
	);
});
