import { expect, test } from "vitest";
import {
  encodeCommand,
  makeSegments,
  SEGMENT_DATA_SIZE,
  USB_PACKET_LIMIT,
} from "../src/wire";

test("encodes commands with compact JSON", () => {
  expect(encodeCommand({ o: "get", t: "model" }).toString("utf8")).toBe(
    '{"o":"get","t":"model"}',
  );
});

test("does not segment commands at or below the USB packet limit", () => {
  const result = makeSegments({ o: "get", t: "model" }, 3);
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0].length).toBeLessThanOrEqual(USB_PACKET_LIMIT);
  expect(result.nextSequenceNumber).toBe(3);
});

test("segments commands over the USB packet limit and advances sequence", () => {
  const command = {
    o: "set",
    k: 1,
    m: "keyboard",
    e: "click",
    v: Array.from({ length: 10 }, () => ({ t: "wait", ms: 10 })),
    r: 1,
  };
  const result = makeSegments(command, 9);
  expect(result.segments).toHaveLength(
    Math.ceil(encodeCommand(command).length / SEGMENT_DATA_SIZE),
  );
  expect(result.segments[0].toString("utf8")).toMatch(/^S9\[1\//);
  expect(result.nextSequenceNumber).toBe(1);
});
