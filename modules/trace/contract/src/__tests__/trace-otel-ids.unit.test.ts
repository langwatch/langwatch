import { describe, expect, it } from "vitest";

import { generateOtelSpanId, generateOtelTraceId } from "../trace-otel-ids.ts";

describe("OpenTelemetry id generation", () => {
  describe("given a generated trace id", () => {
    /** @scenario Generated trace id has the OpenTelemetry format */
    it("is 32 lowercase hexadecimal characters and never the all-zero invalid id", () => {
      const ids = Array.from({ length: 200 }, () => generateOtelTraceId());

      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{32}$/);
        expect(id).not.toBe("0".repeat(32));
      }
    });
  });

  describe("given a generated span id", () => {
    /** @scenario Generated span id has the OpenTelemetry format */
    it("is 16 lowercase hexadecimal characters and never the all-zero invalid id", () => {
      const ids = Array.from({ length: 200 }, () => generateOtelSpanId());

      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{16}$/);
        expect(id).not.toBe("0".repeat(16));
      }
    });
  });

  describe("given many trace ids generated in a row", () => {
    /** @scenario Repeated generation yields unique trace ids */
    it("yields a distinct id on every call", () => {
      const ids = Array.from({ length: 1000 }, () => generateOtelTraceId());

      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
