export type KeyEvent =
  | { t: "down" | "up"; k: string; c: number }
  | { t: "wait"; ms: number };

type MacroKey = { name: string; codeKey: string; shifted: boolean };
export type KeyPlan = {
  key: number;
  text: string;
  events: number;
  chars: MacroKey[];
};
export type TextKeyPlan = {
  keys: KeyPlan[];
  requiredKeys: number;
  totalEvents: number;
};

// The firmware accepts five simultaneous key presses per physical key.
const MAX_PRESSES_PER_KEY = Number(process.env.MACROPAD_MAX_PRESSES) || 5;
const MAX_EVENTS_PER_KEY = 4 * MAX_PRESSES_PER_KEY - 1;
const MAX_CHARS_PER_KEY = MAX_PRESSES_PER_KEY;

const KEY_CODES: Record<string, number> = {
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

const SHIFTED_CHARS: Record<string, string> = {
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

function charCount(text: string): number {
  return Array.from(text).length;
}

function stringToMacroEvents(text: string, delay: number): KeyEvent[] {
  const chars = Array.from(text).map((char, index) => charToTypeKey(char, index));
  const events = generateOptimizedEvents(chars, delay);
  const presses = pressCost(chars);
  if (presses > MAX_PRESSES_PER_KEY) {
    throw new Error(
      `Macro is ${presses} presses; a key supports at most ${MAX_PRESSES_PER_KEY}.`,
    );
  }
  return events;
}

function eventCost(chars: MacroKey[]): number {
  return generateOptimizedEvents(chars, 0).length;
}

function pressCost(chars: MacroKey[]): number {
  let presses = 0;
  let i = 0;
  while (i < chars.length) {
    if (chars[i].shifted) {
      presses += 1; // Shift
      while (i < chars.length && chars[i].shifted) {
        presses += 1;
        i += 1;
      }
    } else {
      presses += 1;
      i += 1;
    }
  }
  return presses;
}

function textToKeyPlan(text: string, keyCount?: number): TextKeyPlan {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Type text must be a non-empty string.");
  }

  const chars = Array.from(text).map((char, index) => charToTypeKey(char, index));
  const assignments = packChars(chars);
  const keys = assignments.map((assignment, index) => ({
    key: index + 1,
    text: assignment.map((char) => char.name).join(""),
    events: eventCost(assignment),
    chars: assignment,
  }));
  const plan = {
    keys,
    requiredKeys: keys.length,
    totalEvents: keys.reduce((total, key) => total + key.events, 0),
  };

  if (keyCount !== undefined && plan.requiredKeys > keyCount) {
    throw new Error(tooLongMessage(plan.requiredKeys, keyCount));
  }
  return plan;
}

function fieldCapacity(text: string, keyCount: number): number {
  const chars = Array.from(text).map((char, index) => charToTypeKey(char, index));
  const packed = packChars(chars, keyCount);
  const fittingChars = packed.reduce(
    (total, assignment) => total + assignment.length,
    0,
  );
  if (fittingChars < chars.length) {
    return fittingChars;
  }

  let capacity = fittingChars;
  const filler: MacroKey = { name: "a", codeKey: "A", shifted: false };
  while (true) {
    const next = packChars([...chars, ...Array(capacity - fittingChars + 1).fill(filler)], keyCount);
    const nextCount = next.reduce(
      (total, assignment) => total + assignment.length,
      0,
    );
    if (nextCount < chars.length + capacity - fittingChars + 1) {
      return capacity;
    }
    capacity += 1;
  }
}

function packChars(chars: MacroKey[], keyCount?: number): MacroKey[][] {
  const assignments: MacroKey[][] = [];
  const remaining = [...chars];

  while (remaining.length > 0 && (!keyCount || assignments.length < keyCount)) {
    const assignment: MacroKey[] = [];
    while (remaining.length > 0) {
      const candidate = [...assignment, remaining[0]];
      if (pressCost(candidate) > MAX_PRESSES_PER_KEY) {
        break;
      }
      const next = remaining.shift();
      if (!next) {
        break;
      }
      assignment.push(next);
    }
    if (assignment.length === 0) {
      throw new Error("A character exceeds the per-key event limit.");
    }
    assignments.push(assignment);
  }

  return assignments;
}

function eventsForPlanKey(key: KeyPlan, delay: number): KeyEvent[] {
  return generateOptimizedEvents(key.chars, delay);
}

function generateOptimizedEvents(chars: MacroKey[], delay: number): KeyEvent[] {
  const events: KeyEvent[] = [];
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
        i += 1;
      }
      events.push({ t: "up", k: "Shift", c: KEY_CODES.Shift });
      if (i < chars.length) {
        events.push({ t: "wait", ms: delay });
      }
    } else {
      events.push(macroKeyEvent("down", chars[i]));
      events.push({ t: "wait", ms: delay });
      events.push(macroKeyEvent("up", chars[i]));
      i += 1;
      if (i < chars.length) {
        events.push({ t: "wait", ms: delay });
      }
    }
  }
  return events;
}

function charToTypeKey(char: string, index: number): MacroKey {
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
    return { name: char, codeKey: normalizeKeyName(baseKey), shifted: true };
  }
  if (char >= "A" && char <= "Z") {
    return { name: char, codeKey: char, shifted: true };
  }
  try {
    return { name: char, codeKey: normalizeKeyName(char), shifted: false };
  } catch {
    throw new Error(
      `Unsupported character at position ${index + 1}: ${JSON.stringify(char)}.`,
    );
  }
}

function macroKeyEvent(type: "down" | "up", key: MacroKey): KeyEvent {
  return { t: type, k: key.name, c: KEY_CODES[key.codeKey] };
}

function normalizeKeyName(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error(`Shortcut key must be a string, got ${typeof input}.`);
  }
  const aliases: Record<string, string> = {
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

function tooLongMessage(requiredKeys: number, keyCount: number): string {
  return (
    `Text too long: needs ${requiredKeys} keys at ${MAX_EVENTS_PER_KEY} events each, ` +
    `but this device has ${keyCount}.`
  );
}

export {
  MAX_EVENTS_PER_KEY,
  MAX_PRESSES_PER_KEY,
  MAX_CHARS_PER_KEY,
  KEY_CODES,
  charCount,
  eventCost,
  eventsForPlanKey,
  fieldCapacity,
  packChars,
  pressCost,
  stringToMacroEvents,
  textToKeyPlan,
};
