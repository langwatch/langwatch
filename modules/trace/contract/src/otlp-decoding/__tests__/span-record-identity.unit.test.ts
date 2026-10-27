import { createHash } from "crypto";

import { getEnvironment, setEnvironment } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SpanRecordIdentityService } from "../span-record-identity.ts";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Main's derivation from first principles: id.utils.ts makeDeterministicKsuid
 * over @langwatch/ksuid 2.0.2 (21 bytes: 48-bit seconds, scheme 'R' = 82,
 * 8 hash bytes, 4 hash bytes as sequence; base62, padded to 29).
 */
const mainSpanRecordId = ({ hashKey, timestampMs }: { hashKey: string; timestampMs: number }) => {
  const hash = createHash("sha256")
    .update(hashKey)
    .update(":")
    .update(String(timestampMs))
    .digest();
  const seconds = Math.floor(timestampMs / 1000);
  const bytes = new Uint8Array(21);
  // Main's 32-bit `>>` wraps: `>> 40` is `>> 8` and `>> 32` is `>> 0`.
  [8, 0, 24, 16, 8, 0].forEach((shift, i) => (bytes[2 + i] = (seconds >> shift) & 0xff));
  bytes[8] = 82;
  bytes.set(hash.subarray(0, 12), 9);
  let num = 0n;
  for (const byte of bytes) num = (num << 8n) | BigInt(byte);
  let encoded = "";
  while (num > 0n) {
    encoded = BASE62[Number(num % 62n)] + encoded;
    num /= 62n;
  }
  return `local_span_${encoded.padStart(29, "0")}`;
};

const cases = [
  {
    tenantId: "project_abc",
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    startTimeUnixMs: 1700000000123,
    expected: "local_span_0008KLI9Hdp8KqjE9nT9uWPIm0iWJ",
  },
  {
    tenantId: "tenant-2",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    startTimeUnixMs: 1735689600999,
    expected: "local_span_0004c1bDxmEIo6gcO8WfNe3JJqBJ7",
  },
];

describe("generateDeterministicSpanRecordIdFromData", () => {
  const previous = getEnvironment();
  beforeAll(() => setEnvironment("local"));
  afterAll(() => setEnvironment(previous));

  describe("when the environment is local", () => {
    it.each(cases)("matches main's id for $tenantId", ({ expected, ...input }) => {
      const id =
        SpanRecordIdentityService.create().generateDeterministicSpanRecordIdFromData(input);
      expect(id).toBe(expected);
      expect(id).toBe(
        mainSpanRecordId({
          hashKey: `${input.tenantId}:${input.traceId}:${input.spanId}`,
          timestampMs: input.startTimeUnixMs,
        }),
      );
    });
  });
});
