import { describe, expect, it } from "vitest";
import { generateOtelSpanId, generateOtelTraceId } from "./trace";

describe("generateOtelTraceId", () => {
  /** @scenario Generated trace id has the OpenTelemetry format */
  it("returns 32 lowercase hex characters that are not the all-zero id", () => {
    const traceId = generateOtelTraceId();
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(traceId).not.toBe("0".repeat(32));
  });

  describe("when called repeatedly", () => {
    /** @scenario Repeated generation yields unique trace ids */
    it("produces unique ids", () => {
      const ids = new Set(
        Array.from({ length: 1000 }, () => generateOtelTraceId()),
      );
      expect(ids.size).toBe(1000);
    });
  });
});

describe("generateOtelSpanId", () => {
  /** @scenario Generated span id has the OpenTelemetry format */
  it("returns 16 lowercase hex characters that are not the all-zero id", () => {
    const spanId = generateOtelSpanId();
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(spanId).not.toBe("0".repeat(16));
  });

  describe("when called repeatedly", () => {
    it("produces unique ids", () => {
      const ids = new Set(
        Array.from({ length: 1000 }, () => generateOtelSpanId()),
      );
      expect(ids.size).toBe(1000);
    });
  });
});
