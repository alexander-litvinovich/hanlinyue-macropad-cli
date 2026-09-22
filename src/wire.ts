type Command = Record<string, unknown>;

const USB_PACKET_LIMIT = 64;
const SEGMENT_DATA_SIZE = 55;

function encodeCommand(command: Command | string): Buffer {
  if (typeof command === "string") {
    return Buffer.from(JSON.stringify(JSON.parse(command)), "utf8");
  }
  if (command && typeof command === "object" && !Array.isArray(command)) {
    return Buffer.from(JSON.stringify(command), "utf8");
  }
  throw new Error("Command must be a JSON string or object.");
}

function makeSegments(command: Command | string, sequenceNumber = 1) {
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

function normalizeSequence(value: unknown): number {
  const seq = Number(value);
  if (!Number.isInteger(seq) || seq < 1 || seq > 9) {
    throw new Error("Sequence number must be an integer from 1 to 9.");
  }
  return seq;
}

export { USB_PACKET_LIMIT, SEGMENT_DATA_SIZE, encodeCommand, makeSegments };
