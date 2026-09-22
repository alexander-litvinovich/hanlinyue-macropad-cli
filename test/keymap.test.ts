import { expect, test } from "vitest";
import {
	charCount,
	fieldCapacity,
	MAX_CHARS_PER_KEY,
	MAX_EVENTS_PER_KEY,
	MAX_PRESSES_PER_KEY,
	pressCost,
	stringToMacroEvents,
	textToKeyPlan,
} from "../src/keymap";

test("counts Unicode code points consistently", () => {
	expect(charCount("a😀b")).toBe(3);
});

test("emits a shifted character with one Shift hold", () => {
	expect(stringToMacroEvents("@", 30)).toEqual([
		{ t: "down", k: "Shift", c: 16 },
		{ t: "wait", ms: 30 },
		{ t: "down", k: "@", c: 50 },
		{ t: "wait", ms: 30 },
		{ t: "up", k: "@", c: 50 },
		{ t: "wait", ms: 30 },
		{ t: "up", k: "Shift", c: 16 },
	]);
});

test("derives the unshifted key capacity from the press limit", () => {
	const full = textToKeyPlan("a".repeat(MAX_CHARS_PER_KEY));
	expect(full.requiredKeys).toBe(1);
	expect(pressCost(full.keys[0].chars)).toBe(MAX_PRESSES_PER_KEY);
	expect(full.keys[0].events).toBe(MAX_EVENTS_PER_KEY);
	expect(textToKeyPlan("a".repeat(MAX_CHARS_PER_KEY + 1)).requiredKeys).toBe(2);
});

test("keeps every generated key within the firmware press limit", () => {
	for (const text of ["12ACAB!1", "H#2y6mlft", "ABCDE"]) {
		for (const key of textToKeyPlan(text).keys) {
			expect(pressCost(key.chars)).toBeLessThanOrEqual(MAX_PRESSES_PER_KEY);
		}
	}
});

test("returns an unlimited plan for text that exceeds a Free2", () => {
	expect(textToKeyPlan("qwertyuiopq")).toMatchObject({
		requiredKeys: 3,
		totalEvents: 41,
		keys: [
			{ key: 1, text: "qwert", events: 19 },
			{ key: 2, text: "yuiop", events: 19 },
			{ key: 3, text: "q", events: 3 },
		],
	});
});

test("rejects plans that exceed the supplied key count", () => {
	expect(() => textToKeyPlan("qwertyuiopq", 2)).toThrow(/needs 3 keys/);
});

test("sizes the field from remaining event capacity", () => {
	expect(fieldCapacity("", 2)).toBe(10);
	expect(fieldCapacity("hello", 2)).toBe(10);
	expect(fieldCapacity("G!", 2)).toBe(9);
	expect(fieldCapacity("H#2y6mlft", 2)).toBe(9);
});

test("ends the field before an overflowing tail", () => {
	expect(fieldCapacity("qwertyuioA", 2)).toBe(9);
});

test("packs shifted runs and reopens Shift after a key boundary", () => {
	expect(textToKeyPlan("ABCDE")).toMatchObject({
		keys: [
			{ key: 1, text: "ABCD", events: 19 },
			{ key: 2, text: "E", events: 7 },
		],
	});
});

test("derives event counts from the number of presses", () => {
	for (const text of ["hello", "G!", "ABCDE", "G!5y"]) {
		for (const key of textToKeyPlan(text).keys) {
			expect(key.events).toBe(4 * pressCost(key.chars) - 1);
		}
	}
});
