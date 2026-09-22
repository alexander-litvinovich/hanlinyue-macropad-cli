import {
  eventsForPlanKey,
  stringToMacroEvents,
  textToKeyPlan,
} from "./keymap";

export type Repeat = number | "forever";

type Command = Record<string, unknown>;
type MacroOptions = {
  key?: string | number;
  delay?: string | number;
  repeat?: string | number;
  layer?: string;
  keyCount?: number;
};

const DEFAULT_LAYER = "click";
const VALID_KEYS = new Set([1, 2]);
const VALID_LAYERS = new Set(["click", "doubleclick", "longpress"]);
const MODEL_KEY_COUNTS: Record<string, number> = {
  Free2: 2,
  Free3: 3,
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

function presetCommand(name: string): Command {
  if (!PRESETS.has(name)) {
    throw new Error(
      `Unknown Free2 preset "${name}". Valid presets: ${Array.from(PRESETS).join(", ")}`,
    );
  }
  return { o: "set", m: "preset", v: name };
}

function keyCountForModel(model: unknown): number {
  const normalized = String(model);
  const keyCount = MODEL_KEY_COUNTS[normalized];
  if (!keyCount) {
    throw new Error(
      `Unsupported model "${normalized}". Supported models: ${Object.keys(MODEL_KEY_COUNTS).join(", ")}.`,
    );
  }
  return keyCount;
}

function infoCommands(): Command[] {
  return [
    { o: "get", t: "model" },
    { o: "get", t: "battery" },
    { o: "get", t: "firmware" },
    { o: "get", t: "mac" },
  ];
}

function stringToMacroCommand(
  text: string,
  options: MacroOptions = {},
): Command {
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

  return {
    o: "set",
    k: key,
    m: "keyboard",
    e: layer,
    v: stringToMacroEvents(text, normalizeDelay(options.delay ?? 30)),
    r: normalizeRepeat(options.repeat ?? 1),
  };
}

function stringToTypeCommands(
  text: string,
  options: MacroOptions = {},
): Command[] {
  const delay = normalizeDelay(options.delay ?? 30);
  const repeat = normalizeRepeat(options.repeat ?? 1);
  const layer = options.layer || DEFAULT_LAYER;
  if (!VALID_LAYERS.has(layer)) {
    throw new Error(
      `Layer must be one of: ${Array.from(VALID_LAYERS).join(", ")}.`,
    );
  }

  const keyCount = normalizeKeyCount(options.keyCount ?? 2);
  const plan = textToKeyPlan(text, keyCount);
  return plan.keys.map((key) => ({
    o: "set",
    k: key.key,
    m: "keyboard",
    e: layer,
    v: eventsForPlanKey(key, delay),
    r: repeat,
  }));
}

function normalizeRepeat(repeat: unknown): Repeat {
  if (repeat === "forever") {
    return repeat;
  }
  const value = Number(repeat);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Macro repeat must be a positive integer or "forever".');
  }
  return value;
}

function normalizeDelay(delay: unknown): number {
  const value = Number(delay);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Macro delay must be a non-negative integer.");
  }
  return value;
}

function normalizeKeyCount(value: unknown): number {
  const keyCount = Number(value);
  if (!Number.isInteger(keyCount) || keyCount < 1) {
    throw new Error("Key count must be a positive integer.");
  }
  return keyCount;
}

export {
  PRESETS,
  MODEL_KEY_COUNTS,
  infoCommands,
  keyCountForModel,
  presetCommand,
  stringToMacroCommand,
  stringToTypeCommands,
};
