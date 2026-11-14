import { createHash } from "crypto";

import { getEnvironment, parse, setEnvironment, type KsuidLayout } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SpanRecordIdentityService } from "../span-record-identity.ts";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * The derivation from first principles: 21 bytes, 48-bit seconds at 2-7, scheme 'R' = 82,
 * 12 hash bytes; base62, padded to 29. "v1-legacy" is what @langwatch/ksuid 2.0.2 wrote:
 * its 32-bit `>>` made `>> 40` `>> 8` (#9575).
 */
const derivedId = ({
  resource,
  hashKey,
  timestampMs,
  layout,
}: {
  resource: string;
  hashKey: string;
  timestampMs: number;
  layout: KsuidLayout;
}) => {
  const hash = createHash("sha256")
    .update(hashKey)
    .update(":")
    .update(String(timestampMs))
    .digest();
  const seconds = Math.floor(timestampMs / 1000);
  const bytes = new Uint8Array(21);
  const shifts = layout === "v1-legacy" ? [8, 0, 24, 16, 8, 0] : [40, 32, 24, 16, 8, 0];
  shifts.forEach((shift, i) => (bytes[2 + i] = Number((BigInt(seconds) >> BigInt(shift)) & 0xffn)));
  bytes[8] = 82;
  bytes.set(hash.subarray(0, 12), 9);
  let num = 0n;
  for (const byte of bytes) num = (num << 8n) | BigInt(byte);
  let encoded = "";
  while (num > 0n) {
    encoded = BASE62[Number(num % 62n)] + encoded;
    num /= 62n;
  }
  return `local_${resource}_${encoded.padStart(29, "0")}`;
};

const cases = [
  {
    tenantId: "project_abc",
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    startTimeUnixMs: 1700000000123,
    expected: "local_span_000000CjTy6fZNuSWG7DlvIX9jMo7",
  },
  {
    tenantId: "tenant-2",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    startTimeUnixMs: 1735689600999,
    expected: "local_span_000000D03ZnU8tQKUPALuRTH7liQf",
  },
];

describe("generateDeterministicSpanRecordIdFromData", () => {
  const previous = getEnvironment();
  beforeAll(() => setEnvironment("local"));
  afterAll(() => setEnvironment(previous));

  describe("when the environment is local", () => {
    /** @scenario "A span record id is minted in the corrected layout" */
    it.each(cases)("derives the v2 id for $tenantId", ({ expected, ...input }) => {
      const id =
        SpanRecordIdentityService.create().generateDeterministicSpanRecordIdFromData(input);
      expect(id).toBe(expected);
      expect(id).toBe(
        derivedId({
          resource: "span",
          hashKey: `${input.tenantId}:${input.traceId}:${input.spanId}`,
          timestampMs: input.startTimeUnixMs,
          layout: "v2",
        }),
      );
      expect(parse(id).layout).toBe("v2");
    });
  });
});

describe("generateDeterministicTraceSummaryIdFromData", () => {
  const previous = getEnvironment();
  beforeAll(() => setEnvironment("local"));
  afterAll(() => setEnvironment(previous));

  describe.each(["v1-legacy", "v2"] as const)("when the stored layout is %s", (layout) => {
    it.each(cases)("derives the id in that layout for $tenantId", (input) => {
      const id = SpanRecordIdentityService.create().generateDeterministicTraceSummaryIdFromData({
        tenantId: input.tenantId,
        traceId: input.traceId,
        startTimeUnixMs: input.startTimeUnixMs,
        layout,
      });
      expect(id).toBe(
        derivedId({
          resource: "tracesummary",
          hashKey: `${input.tenantId}:${input.traceId}`,
          timestampMs: input.startTimeUnixMs,
          layout,
        }),
      );
      expect(parse(id).layout).toBe(layout);
    });
  });
});
