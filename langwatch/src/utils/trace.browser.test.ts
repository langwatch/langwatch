/**
 * Real-Chromium check that trace/span id generation works in an actual
 * browser. The production crash was a bundling failure, but this also proves
 * the runtime path (global Web Crypto) is available client-side, not only in
 * Node.
 */

import { describe, expect, it } from "vitest";
import { generateOtelSpanId, generateOtelTraceId } from "./trace";

describe("trace id generation in real Chromium", () => {
  it("generates a valid OTel trace id", () => {
    expect(generateOtelTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateOtelTraceId()).not.toBe("0".repeat(32));
  });

  it("generates a valid OTel span id", () => {
    expect(generateOtelSpanId()).toMatch(/^[0-9a-f]{16}$/);
    expect(generateOtelSpanId()).not.toBe("0".repeat(16));
  });

  it("does not reuse ids across calls", () => {
    expect(generateOtelTraceId()).not.toBe(generateOtelTraceId());
  });
});
