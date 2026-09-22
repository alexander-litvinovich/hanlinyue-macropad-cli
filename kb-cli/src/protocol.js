"use strict";

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const USB_PACKET_LIMIT = 64;
const SEGMENT_DATA_SIZE = 55;
const DEFAULT_LAYER = "click";
const VALID_KEYS = new Set([1, 2]);
const VALID_LAYERS = new Set(["click", "doubleclick", "longpress"]);
const VALID_TYPES = new Set(["keyboard", "phone", "macro"]);
const VALID_SHIFTS = new Set(["P", "M", "R"]);

const KEY_CODES = {
  Escape: 27,
  AudioVolumeMute: 173,
  AudioVolumeDown: 174,
  AudioVolumeUp: 175,
  MediaTrackPrevious: 177,
  MediaStop: 178,
  MediaTrackNext: 176,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Backspace: 8,
  Delete: 46,
  Tab: 9,
  CapsLock: 20,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Ctrl: 17,
  Meta: 91,
  Win: 91,
  Alt: 18,
  Space: 32,
  " ": 32,
  ContextMenu: 93,
  Menu: 93,
  "~": 192,
  "-": 189,
  "=": 187,
  "[": 219,
  "]": 221,
  "\\": 220,
  ";": 186,
  "'": 222,
  ",": 188,
  ".": 190,
  "/": 191,
};

for (let i = 1; i <= 12; i += 1) {
  KEY_CODES[`F${i}`] = 111 + i;
}
for (let i = 0; i <= 9; i += 1) {
  KEY_CODES[String(i)] = i === 0 ? 48 : 48 + i;
}
for (let code = 65; code <= 90; code += 1) {
  KEY_CODES[String.fromCharCode(code)] = code;
}

// Characters that require Shift + a base key (US keyboard layout)
const SHIFTED_CHARS = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
};

const PRESETS = new Set([
  "pageturn_android",
  "keyboard_lr",
  "keyboard_pud",
  "keyboard_cv",
  "mouse_1",
  "mouse_2",
  "keyboard_ud",
  "mouse_3",
]);

const PHONE_ACTION_ALIASES = {
  like: "like",
  lockscreen: "lockscreen",
  lock_screen: "lockscreen",
  speed: "speed",
  slideleft: "slideleft",
  slideright: "slideright",
  slideup: "slideup",
  slidedown: "slidedown",
  swipe_left: "slideleft",
  swipe_right: "slideright",
  swipe_up: "slideup",
  swipe_down: "slidedown",
  pause: "pause",
  back: "back",
  home: "home",
};

function encodeCommand(command) {
  if (typeof command === "string") {
    return Buffer.from(JSON.stringify(JSON.parse(command)), "utf8");
  }
  if (command && typeof command === "object" && !Array.isArray(command)) {
    return Buffer.from(JSON.stringify(command), "utf8");
  }
  throw new Error("Command must be a JSON string or object.");
}

function makeSegments(command, sequenceNumber = 1) {
  const data = encodeCommand(command);
  const seq = normalizeSequence(sequenceNumber);

  if (data.length <= USB_PACKET_LIMIT) {
    return {
      sequenceNumber: seq,
      nextSequenceNumber: seq,
      segments: [data],
    };
  }

  const total = Math.ceil(data.length / SEGMENT_DATA_SIZE);
  const segments = [];
  for (let i = 0; i < total; i += 1) {
    const start = i * SEGMENT_DATA_SIZE;
    const end = Math.min(start + SEGMENT_DATA_SIZE, data.length);
    const header = Buffer.from(`S${seq}[${i + 1}/${total}]`, "utf8");
    segments.push(Buffer.concat([header, data.subarray(start, end)]));
  }

  return {
    sequenceNumber: seq,
    nextSequenceNumber: seq === 9 ? 1 : seq + 1,
    segments,
  };
}

function presetCommand(name) {
  if (!PRESETS.has(name)) {
    throw new Error(
      `Unknown Free2 preset "${name}". Valid presets: ${Array.from(PRESETS).join(", ")}`,
    );
  }
  return { o: "set", m: "preset", v: name };
}

function infoCommands() {
  return [
    { o: "get", t: "model" },
    { o: "get", t: "battery" },
    { o: "get", t: "firmware" },
    { o: "get", t: "mac" },
  ];
}

function loadProfile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    return JSON.parse(text);
  }
  return YAML.parse(text);
}

function profileToCommands(profile) {
  if (!profile || typeof profile !== "object") {
    throw new Error("Profile must be an object.");
  }
  if (profile.model && profile.model !== "Free2") {
    throw new Error(`Only model "Free2" is supported, got "${profile.model}".`);
  }
  if (!Array.isArray(profile.keys) || profile.keys.length === 0) {
    throw new Error("Profile must contain a non-empty keys array.");
  }

  return profile.keys.flatMap((entry, index) => {
    const shifts = normalizeShifts(entry, index);
    return shifts.map((shift) => keyEntryToCommand(entry, index, shift));
  });
}

function keyEntryToCommand(entry, index, shift) {
  if (!entry || typeof entry !== "object") {
    throw new Error(`keys[${index}] must be an object.`);
  }

  const key = Number(entry.key);
  if (!VALID_KEYS.has(key)) {
    throw new Error(`keys[${index}].key must be 1 or 2.`);
  }

  const layer = entry.layer || DEFAULT_LAYER;
  if (!VALID_LAYERS.has(layer)) {
    throw new Error(
      `keys[${index}].layer must be one of: ${Array.from(VALID_LAYERS).join(", ")}.`,
    );
  }

  const type = entry.type;
  if (!VALID_TYPES.has(type)) {
    throw new Error(
      `keys[${index}].type must be one of: ${Array.from(VALID_TYPES).join(", ")}.`,
    );
  }

  if (type === "keyboard") {
    const events = entry.events || shortcutToEvents(entry.shortcut, index);
    validateEvents(events, `keys[${index}].events`);
    return withShift(
      { o: "set", k: key, m: "keyboard", e: layer, v: events, r: 1 },
      shift,
    );
  }

  if (type === "phone") {
    const action = normalizePhoneAction(entry.action);
    return withShift(
      { o: "set", k: key, m: "mouse", e: layer, v: action, r: 1 },
      shift,
    );
  }

  const events = entry.events || (entry.macro && entry.macro.events);
  validateEvents(events, `keys[${index}].events`);
  const repeat = normalizeRepeat(
    entry.repeat ?? (entry.macro && entry.macro.repeat) ?? 1,
  );
  return withShift(
    { o: "set", k: key, m: "keyboard", e: layer, v: events, r: repeat },
    shift,
  );
}

function stringToMacroCommand(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Macro text must be a non-empty string.");
  }

  const key = Number(options.key);
  if (!VALID_KEYS.has(key)) {
    throw new Error("Macro key must be 1 or 2.");
  }

  const layer = options.layer || DEFAULT_LAYER;
  if (!VALID_LAYERS.has(layer)) {
    throw new Error(
      `Macro layer must be one of: ${Array.from(VALID_LAYERS).join(", ")}.`,
    );
  }

  const delay = normalizeDelay(options.delay ?? 30);
  const repeat = normalizeRepeat(options.repeat ?? 1);
  const events = stringToMacroEvents(text, delay);

  return {
    o: "set",
    k: key,
    m: "keyboard",
    e: layer,
    v: events,
    r: repeat,
  };
}

function stringToMacroEvents(text, delay) {
  const events = [];
  const chars = Array.from(text);
  chars.forEach((char, index) => {
    const key = charToMacroKey(char, index);
    if (key.shifted) {
      events.push({ t: "down", k: "Shift", c: KEY_CODES.Shift });
      events.push({ t: "wait", ms: delay });
    }
    events.push(macroKeyEvent("down", key));
    events.push({ t: "wait", ms: delay });
    events.push(macroKeyEvent("up", key));
    if (key.shifted) {
      events.push({ t: "wait", ms: delay });
      events.push({ t: "up", k: "Shift", c: KEY_CODES.Shift });
    }
    if (index < chars.length - 1) {
      events.push({ t: "wait", ms: delay });
    }
  });
  return events;
}

const MAX_PRESSES_PER_KEY = 5;

function stringToTypeCommands(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Type text must be a non-empty string.");
  }

  const delay = normalizeDelay(options.delay ?? 30);
  const repeat = normalizeRepeat(options.repeat ?? 1);
  const layer = options.layer || DEFAULT_LAYER;
  if (!VALID_LAYERS.has(layer)) {
    throw new Error(
      `Layer must be one of: ${Array.from(VALID_LAYERS).join(", ")}.`,
    );
  }

  const chars = Array.from(text).map((char, i) => charToTypeKey(char, i));
  const { key1Chars, key2Chars } = splitCharsForKeys(chars);

  const commands = [];
  if (key1Chars.length > 0) {
    commands.push({
      o: "set",
      k: 1,
      m: "keyboard",
      e: layer,
      v: generateOptimizedEvents(key1Chars, delay),
      r: repeat,
    });
  }
  if (key2Chars.length > 0) {
    commands.push({
      o: "set",
      k: 2,
      m: "keyboard",
      e: layer,
      v: generateOptimizedEvents(key2Chars, delay),
      r: repeat,
    });
  }

  return commands;
}

function charToTypeKey(char, index) {
  if (char === " ") {
    return { name: " ", codeKey: "Space", shifted: false };
  }
  if (
    char.length !== 1 ||
    char.charCodeAt(0) < 32 ||
    char.charCodeAt(0) > 126
  ) {
    throw new Error(
      `Unsupported character at position ${index + 1}: ${JSON.stringify(char)}.`,
    );
  }
  const baseKey = SHIFTED_CHARS[char];
  if (baseKey) {
    const codeKey = normalizeKeyName(baseKey);
    return { name: char, codeKey, shifted: true };
  }
  if (char >= "A" && char <= "Z") {
    return { name: char, codeKey: char, shifted: true };
  }
  try {
    const codeKey = normalizeKeyName(char);
    return { name: char, codeKey, shifted: false };
  } catch (error) {
    throw new Error(
      `Unsupported character at position ${index + 1}: ${JSON.stringify(char)}.`,
    );
  }
}

function splitCharsForKeys(chars) {
  const max = MAX_PRESSES_PER_KEY;
  const key1Chars = [];
  const key2Chars = [];

  let i = 0;
  let remaining = max;

  // Fill key 1
  while (i < chars.length && remaining > 0) {
    if (chars[i].shifted) {
      if (remaining < 2) break;
      remaining--; // shift press
      while (i < chars.length && chars[i].shifted && remaining > 0) {
        key1Chars.push(chars[i]);
        remaining--;
        i++;
      }
    } else {
      key1Chars.push(chars[i]);
      remaining--;
      i++;
    }
  }

  // Fill key 2
  remaining = max;
  while (i < chars.length && remaining > 0) {
    if (chars[i].shifted) {
      if (remaining < 2) break;
      remaining--;
      while (i < chars.length && chars[i].shifted && remaining > 0) {
        key2Chars.push(chars[i]);
        remaining--;
        i++;
      }
    } else {
      key2Chars.push(chars[i]);
      remaining--;
      i++;
    }
  }

  if (i < chars.length) {
    const placed = key1Chars.length + key2Chars.length;
    throw new Error(
      `Text too long: ${chars.length} characters need more than 2 keys ` +
        `(placed ${placed}, ${chars.length - placed} remaining). ` +
        `Max ${max} key presses per button.`,
    );
  }

  return { key1Chars, key2Chars };
}

function generateOptimizedEvents(chars, delay) {
  const events = [];
  let i = 0;
  while (i < chars.length) {
    if (chars[i].shifted) {
      events.push({ t: "down", k: "Shift", c: KEY_CODES.Shift });
      events.push({ t: "wait", ms: delay });
      while (i < chars.length && chars[i].shifted) {
        events.push(macroKeyEvent("down", chars[i]));
        events.push({ t: "wait", ms: delay });
        events.push(macroKeyEvent("up", chars[i]));
        events.push({ t: "wait", ms: delay });
        i++;
      }
      events.push({ t: "up", k: "Shift", c: KEY_CODES.Shift });
      if (i < chars.length) {
        events.push({ t: "wait", ms: delay });
      }
    } else {
      events.push(macroKeyEvent("down", chars[i]));
      events.push({ t: "wait", ms: delay });
      events.push(macroKeyEvent("up", chars[i]));
      i++;
      if (i < chars.length) {
        events.push({ t: "wait", ms: delay });
      }
    }
  }
  return events;
}

function charToMacroKey(char, index) {
  if (char === " ") {
    return { name: " ", codeKey: "Space", shifted: false };
  }
  if (
    char.length !== 1 ||
    char.charCodeAt(0) < 32 ||
    char.charCodeAt(0) > 126
  ) {
    throw new Error(
      `Unsupported macro character at position ${index + 1}: ${JSON.stringify(char)}.`,
    );
  }
  // Check if this is a shifted character (e.g. @ = Shift+2)
  const baseKey = SHIFTED_CHARS[char];
  if (baseKey) {
    const codeKey = normalizeKeyName(baseKey);
    return { name: char, codeKey, shifted: true };
  }
  try {
    const codeKey = normalizeKeyName(char);
    return { name: char, codeKey, shifted: false };
  } catch (error) {
    throw new Error(
      `Unsupported macro character at position ${index + 1}: ${JSON.stringify(char)}.`,
    );
  }
}

function macroKeyEvent(type, key) {
  return {
    t: type,
    k: key.name,
    c: KEY_CODES[key.codeKey],
  };
}

function normalizeShifts(entry, index) {
  if (entry.shift && entry.shifts) {
    throw new Error(
      `keys[${index}] must use either shift or shifts, not both.`,
    );
  }
  const values = entry.shifts
    ? entry.shifts
    : entry.shift
      ? [entry.shift]
      : [null];
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`keys[${index}].shifts must be a non-empty array.`);
  }
  return values.map((value) => {
    if (value === null || value === undefined) {
      return null;
    }
    const shift = String(value).toUpperCase();
    if (!VALID_SHIFTS.has(shift)) {
      throw new Error(
        `keys[${index}].shift must be one of: ${Array.from(VALID_SHIFTS).join(", ")}.`,
      );
    }
    return shift;
  });
}

function withShift(command, shift) {
  return shift ? { ...command, s: shift } : command;
}

function shortcutToEvents(shortcut, index = 0) {
  if (!Array.isArray(shortcut) || shortcut.length === 0) {
    throw new Error(
      `keys[${index}].shortcut must be a non-empty array when events are not provided.`,
    );
  }
  if (shortcut.length > 5) {
    throw new Error(`keys[${index}].shortcut may contain at most 5 keys.`);
  }

  const keys = shortcut.map(normalizeKeyName);
  const modifiers = keys.filter((key) =>
    ["Control", "Shift", "Alt", "Meta"].includes(key),
  );
  const regulars = keys.filter(
    (key) => !["Control", "Shift", "Alt", "Meta"].includes(key),
  );
  const events = [];

  for (const key of modifiers) {
    events.push(keyEvent("down", key));
    events.push({ t: "wait", ms: 10 });
  }

  for (let i = 0; i < regulars.length; i += 1) {
    const key = regulars[i];
    events.push(keyEvent("down", key));
    events.push({ t: "wait", ms: 10 });
    events.push(keyEvent("up", key));
    if (i < regulars.length - 1) {
      events.push({ t: "wait", ms: 10 });
    }
  }

  for (const key of [...modifiers].reverse()) {
    events.push({ t: "wait", ms: 10 });
    events.push(keyEvent("up", key));
  }

  return events;
}

function normalizeKeyName(input) {
  if (typeof input !== "string") {
    throw new Error(`Shortcut key must be a string, got ${typeof input}.`);
  }
  const aliases = {
    Ctrl: "Control",
    Cmd: "Meta",
    Command: "Meta",
    Win: "Meta",
    Windows: "Meta",
    Option: "Alt",
    Spacebar: "Space",
    PgUp: "PageUp",
    PgDn: "PageDown",
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight",
  };
  const key =
    aliases[input] || (input.length === 1 ? input.toUpperCase() : input);
  if (!(key in KEY_CODES)) {
    throw new Error(`Unsupported keyboard key "${input}".`);
  }
  return key;
}

function keyEvent(type, key) {
  return {
    t: type,
    k: key === "Space" ? " " : key,
    c: KEY_CODES[key],
  };
}

function validateEvents(events, label) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  for (const [idx, event] of events.entries()) {
    if (!event || typeof event !== "object") {
      throw new Error(`${label}[${idx}] must be an object.`);
    }
    if (event.t === "wait") {
      if (!Number.isFinite(Number(event.ms)) || Number(event.ms) < 0) {
        throw new Error(`${label}[${idx}].ms must be a non-negative number.`);
      }
    } else if (event.t === "down" || event.t === "up") {
      if (typeof event.k !== "string" || event.k.length === 0) {
        throw new Error(`${label}[${idx}].k must be a non-empty string.`);
      }
      if (!Number.isFinite(Number(event.c))) {
        throw new Error(`${label}[${idx}].c must be a number.`);
      }
    } else {
      throw new Error(`${label}[${idx}].t must be down, up, or wait.`);
    }
  }
}

function normalizePhoneAction(action) {
  if (typeof action !== "string") {
    throw new Error("Phone action must be a string.");
  }
  const normalized = PHONE_ACTION_ALIASES[action];
  if (!normalized) {
    throw new Error(
      `Unsupported phone action "${action}". Valid actions: ${Object.keys(PHONE_ACTION_ALIASES).join(", ")}`,
    );
  }
  return normalized;
}

function normalizeRepeat(repeat) {
  if (repeat === "forever") {
    return repeat;
  }
  const value = Number(repeat);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Macro repeat must be a positive integer or "forever".');
  }
  return value;
}

function normalizeDelay(delay) {
  const value = Number(delay);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Macro delay must be a non-negative integer.");
  }
  return value;
}

function normalizeSequence(value) {
  const seq = Number(value);
  if (!Number.isInteger(seq) || seq < 1 || seq > 9) {
    throw new Error("Sequence number must be an integer from 1 to 9.");
  }
  return seq;
}

module.exports = {
  USB_PACKET_LIMIT,
  SEGMENT_DATA_SIZE,
  MAX_PRESSES_PER_KEY,
  KEY_CODES,
  PRESETS,
  PHONE_ACTION_ALIASES,
  encodeCommand,
  makeSegments,
  presetCommand,
  infoCommands,
  loadProfile,
  profileToCommands,
  stringToMacroCommand,
  stringToTypeCommands,
  shortcutToEvents,
  normalizePhoneAction,
};
