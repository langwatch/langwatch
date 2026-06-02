import { describe, expect, it } from "vitest";

import {
  MAX_EVALUATION_PAYLOAD_BYTES,
  capInputs,
  capPayloadText,
} from "../evaluation-run.payload-cap";

const ctx = { tenantId: "tenant-1", evaluationId: "eval-1" };
const overCap = (extra: number) =>
  "a".repeat(MAX_EVALUATION_PAYLOAD_BYTES + extra);

describe("capPayloadText", () => {
  it("passes null through unchanged", () => {
    expect(capPayloadText(null, "Details", ctx)).toBeNull();
  });

  it("returns small values unchanged", () => {
    expect(capPayloadText("hello", "Error", ctx)).toBe("hello");
  });

  it("returns values exactly at the cap unchanged", () => {
    const atCap = "a".repeat(MAX_EVALUATION_PAYLOAD_BYTES);
    expect(capPayloadText(atCap, "Details", ctx)).toBe(atCap);
  });

  it("truncates oversized values to a bounded, observable marker", () => {
    const result = capPayloadText(overCap(1), "Details", ctx)!;
    expect(result).toContain("[truncated: evaluation_runs Details was");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThan(
      MAX_EVALUATION_PAYLOAD_BYTES,
    );
  });

  it("uses byte length, not char count, for multibyte strings", () => {
    // "✓" is 3 UTF-8 bytes; just over the cap by bytes, under it by char count.
    const value = "✓".repeat(Math.ceil(MAX_EVALUATION_PAYLOAD_BYTES / 3) + 1);
    expect(value.length).toBeLessThan(MAX_EVALUATION_PAYLOAD_BYTES);
    expect(capPayloadText(value, "ErrorDetails", ctx)).toContain("[truncated");
  });
});

describe("capInputs", () => {
  it("returns null for null/undefined inputs", () => {
    expect(capInputs(null, ctx)).toBeNull();
    expect(capInputs(undefined as never, ctx)).toBeNull();
  });

  it("serializes small inputs as-is", () => {
    expect(capInputs({ a: 1, b: "x" }, ctx)).toBe('{"a":1,"b":"x"}');
  });

  it("replaces oversized inputs with a valid-JSON marker object", () => {
    const result = capInputs({ blob: overCap(100) }, ctx)!;
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed.__truncated).toBe(true);
    expect(parsed.field).toBe("Inputs");
    expect(parsed.cap).toBe(MAX_EVALUATION_PAYLOAD_BYTES);
    expect(parsed.originalBytes as number).toBeGreaterThan(
      MAX_EVALUATION_PAYLOAD_BYTES,
    );
    expect(Buffer.byteLength(result, "utf8")).toBeLessThan(
      MAX_EVALUATION_PAYLOAD_BYTES,
    );
  });
});
