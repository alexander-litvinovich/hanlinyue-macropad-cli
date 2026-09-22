import { expect, test } from "vitest";
import {
  infoCommands,
  keyCountForModel,
  presetCommand,
  stringToMacroCommand,
  stringToTypeCommands,
} from "../src/commands";
import { MAX_EVENTS_PER_KEY } from "../src/keymap";

test("creates presets and rejects an unknown one", () => {
  expect(presetCommand("keyboard_lr")).toEqual({
    o: "set",
    m: "preset",
    v: "keyboard_lr",
  });
  expect(() => presetCommand("nope")).toThrow(/Unknown Free2 preset/);
});

test("returns the supported device info queries", () => {
  expect(infoCommands()).toEqual([
    { o: "get", t: "model" },
    { o: "get", t: "battery" },
    { o: "get", t: "firmware" },
    { o: "get", t: "mac" },
  ]);
});

test("creates a macro command with options", () => {
  expect(stringToMacroCommand("[eq", {
    key: 2,
    delay: 50,
    repeat: "forever",
    layer: "longpress",
  })).toMatchObject({
    o: "set",
    k: 2,
    m: "keyboard",
    e: "longpress",
    r: "forever",
  });
});

test("validates macro options", () => {
  expect(() => stringToMacroCommand("", { key: 1 })).toThrow(/non-empty string/);
  expect(() => stringToMacroCommand("a", { key: 3 })).toThrow(/key must be 1 or 2/);
  expect(() => stringToMacroCommand("a", { key: 1, delay: -1 })).toThrow(/delay must be/);
  expect(() => stringToMacroCommand("a", { key: 1, layer: "tap" })).toThrow(/layer must be/);
});

test("creates type commands for all three Free3 keys", () => {
  const commands = stringToTypeCommands("qwertyuiopq", { keyCount: 3 });
  expect(commands).toHaveLength(3);
  expect(commands.map((command) => command.k)).toEqual([1, 2, 3]);
  expect(
    commands.every(
      (command) => (command.v as unknown[]).length <= MAX_EVENTS_PER_KEY,
    ),
  ).toBe(true);
});

test("maps supported models to the correct key counts", () => {
  expect(keyCountForModel("Free2")).toBe(2);
  expect(keyCountForModel("Free3")).toBe(3);
  expect(() => keyCountForModel("Free99")).toThrow(/Unsupported model/);
});
