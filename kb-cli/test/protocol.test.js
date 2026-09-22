"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  encodeCommand,
  makeSegments,
  normalizePhoneAction,
  presetCommand,
  profileToCommands,
  stringToMacroCommand,
  shortcutToEvents,
} = require("../src/protocol");

test("encodes commands with compact JSON", () => {
  assert.equal(
    encodeCommand({ o: "get", t: "model" }).toString("utf8"),
    '{"o":"get","t":"model"}',
  );
});

test("does not segment commands at or below the packet limit", () => {
  const result = makeSegments({ o: "get", t: "model" }, 3);
  assert.equal(result.segments.length, 1);
  assert.equal(result.nextSequenceNumber, 3);
});

test("segments commands longer than 64 bytes and advances sequence", () => {
  const command = {
    o: "set",
    k: 1,
    m: "keyboard",
    e: "click",
    v: Array.from({ length: 10 }, () => ({ t: "wait", ms: 10 })),
    r: 1,
  };
  const result = makeSegments(command, 9);
  assert.ok(result.segments.length > 1);
  assert.equal(result.segments[0].toString("utf8").startsWith("S9[1/"), true);
  assert.equal(result.nextSequenceNumber, 1);
});

test("creates preset command and rejects unknown preset", () => {
  assert.deepEqual(presetCommand("keyboard_lr"), {
    o: "set",
    m: "preset",
    v: "keyboard_lr",
  });
  assert.throws(() => presetCommand("nope"), /Unknown Free2 preset/);
});

test("converts keyboard shortcut to app event format", () => {
  assert.deepEqual(shortcutToEvents(["Control", "C"]), [
    { t: "down", k: "Control", c: 17 },
    { t: "wait", ms: 10 },
    { t: "down", k: "C", c: 67 },
    { t: "wait", ms: 10 },
    { t: "up", k: "C", c: 67 },
    { t: "wait", ms: 10 },
    { t: "up", k: "Control", c: 17 },
  ]);
});

test("normalizes phone aliases", () => {
  assert.equal(normalizePhoneAction("swipe_up"), "slideup");
  assert.equal(normalizePhoneAction("slideup"), "slideup");
  assert.throws(() => normalizePhoneAction("zoom"), /Unsupported phone action/);
});

test("converts profile entries to device commands", () => {
  const commands = profileToCommands({
    model: "Free2",
    keys: [
      { key: 1, layer: "click", type: "keyboard", shortcut: ["Control", "C"] },
      { key: 2, layer: "longpress", type: "phone", action: "swipe_down" },
      {
        key: 1,
        layer: "doubleclick",
        type: "macro",
        repeat: "forever",
        events: [{ t: "wait", ms: 25 }],
      },
    ],
  });

  assert.equal(commands.length, 3);
  assert.equal(commands[0].m, "keyboard");
  assert.equal(commands[1].v, "slidedown");
  assert.deepEqual(commands[2].v, [{ t: "wait", ms: 25 }]);
  assert.equal(commands[2].r, "forever");
});

test("creates macro command from plain text with default delay", () => {
  assert.deepEqual(stringToMacroCommand("qwerty", { key: 1 }), {
    o: "set",
    k: 1,
    m: "keyboard",
    e: "click",
    v: [
      { t: "down", k: "q", c: 81 },
      { t: "wait", ms: 30 },
      { t: "up", k: "q", c: 81 },
      { t: "wait", ms: 30 },
      { t: "down", k: "w", c: 87 },
      { t: "wait", ms: 30 },
      { t: "up", k: "w", c: 87 },
      { t: "wait", ms: 30 },
      { t: "down", k: "e", c: 69 },
      { t: "wait", ms: 30 },
      { t: "up", k: "e", c: 69 },
      { t: "wait", ms: 30 },
      { t: "down", k: "r", c: 82 },
      { t: "wait", ms: 30 },
      { t: "up", k: "r", c: 82 },
      { t: "wait", ms: 30 },
      { t: "down", k: "t", c: 84 },
      { t: "wait", ms: 30 },
      { t: "up", k: "t", c: 84 },
      { t: "wait", ms: 30 },
      { t: "down", k: "y", c: 89 },
      { t: "wait", ms: 30 },
      { t: "up", k: "y", c: 89 },
    ],
    r: 1,
  });
});

test("creates macro command with custom delay, repeat, layer, and punctuation", () => {
  assert.deepEqual(
    stringToMacroCommand("[eq", {
      key: 2,
      delay: 50,
      repeat: "forever",
      layer: "longpress",
    }),
    {
      o: "set",
      k: 2,
      m: "keyboard",
      e: "longpress",
      v: [
        { t: "down", k: "[", c: 219 },
        { t: "wait", ms: 50 },
        { t: "up", k: "[", c: 219 },
        { t: "wait", ms: 50 },
        { t: "down", k: "e", c: 69 },
        { t: "wait", ms: 50 },
        { t: "up", k: "e", c: 69 },
        { t: "wait", ms: 50 },
        { t: "down", k: "q", c: 81 },
        { t: "wait", ms: 50 },
        { t: "up", k: "q", c: 81 },
      ],
      r: "forever",
    },
  );
});

test("validates plain text macro options", () => {
  assert.throws(() => stringToMacroCommand("", { key: 1 }), /non-empty string/);
  assert.throws(
    () => stringToMacroCommand("a", { key: 3 }),
    /key must be 1 or 2/,
  );
  assert.throws(
    () => stringToMacroCommand("a", { key: 1, delay: -1 }),
    /delay must be/,
  );
  assert.throws(
    () => stringToMacroCommand("a", { key: 1, layer: "tap" }),
    /layer must be/,
  );
  assert.throws(
    () => stringToMacroCommand("\x01", { key: 1 }),
    /Unsupported macro character/,
  );
});

test("creates macro with shifted characters wrapped in Shift events", () => {
  const result = stringToMacroCommand("@", { key: 1, delay: 30 });
  assert.deepEqual(result.v, [
    { t: "down", k: "Shift", c: 16 },
    { t: "wait", ms: 30 },
    { t: "down", k: "@", c: 50 },
    { t: "wait", ms: 30 },
    { t: "up", k: "@", c: 50 },
    { t: "wait", ms: 30 },
    { t: "up", k: "Shift", c: 16 },
  ]);
});

test("creates macro mixing shifted and unshifted characters", () => {
  const result = stringToMacroCommand("a@1", { key: 1, delay: 10 });
  assert.deepEqual(result.v, [
    { t: "down", k: "a", c: 65 },
    { t: "wait", ms: 10 },
    { t: "up", k: "a", c: 65 },
    { t: "wait", ms: 10 },
    { t: "down", k: "Shift", c: 16 },
    { t: "wait", ms: 10 },
    { t: "down", k: "@", c: 50 },
    { t: "wait", ms: 10 },
    { t: "up", k: "@", c: 50 },
    { t: "wait", ms: 10 },
    { t: "up", k: "Shift", c: 16 },
    { t: "wait", ms: 10 },
    { t: "down", k: "1", c: 49 },
    { t: "wait", ms: 10 },
    { t: "up", k: "1", c: 49 },
  ]);
});

test("expands profile entries with multiple shifts", () => {
  const commands = profileToCommands({
    model: "Free2",
    keys: [
      {
        key: 1,
        layer: "click",
        shifts: ["P", "M", "R"],
        type: "phone",
        action: "home",
      },
    ],
  });

  assert.deepEqual(
    commands.map((command) => command.s),
    ["P", "M", "R"],
  );
  assert.equal(
    commands.every((command) => command.m === "mouse"),
    true,
  );
});

test("validates profile key and layer", () => {
  assert.throws(
    () =>
      profileToCommands({
        model: "Free2",
        keys: [{ key: 3, type: "phone", action: "home" }],
      }),
    /key must be 1 or 2/,
  );
  assert.throws(
    () =>
      profileToCommands({
        model: "Free2",
        keys: [{ key: 1, layer: "tap", type: "phone", action: "home" }],
      }),
    /layer must be/,
  );
  assert.throws(
    () =>
      profileToCommands({
        model: "Free2",
        keys: [{ key: 1, shift: "X", type: "phone", action: "home" }],
      }),
    /shift must be/,
  );
});
