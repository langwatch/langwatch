import { describe, expect, it } from "vitest";

import { epochMsToOtlpNanos } from "../collectorSpan.utils";

// Spec: one exact BigInt conversion shared by every span writer (#8038).
// `ms * 1_000_000` exceeds Number.MAX_SAFE_INTEGER for real epoch values,
// so the float product's low digits are rounding noise.
describe("epochMsToOtlpNanos", () => {
  describe("given a current epoch millisecond value", () => {
    it("produces the exact nanosecond string", () => {
      expect(epochMsToOtlpNanos(1_757_400_000_001)).toBe(
        "1757400000001000000",
      );
    });

    it("stays exact past Number.MAX_SAFE_INTEGER nanoseconds", () => {
      // ~1.7e18 ns is far beyond 2^53; BigInt keeps every digit where float
      // arithmetic is only saved by shortest-round-trip printing today.
      expect(epochMsToOtlpNanos(1_757_399_999_999)).toBe(
        "1757399999999000000",
      );
    });
  });

  describe("given fractional millisecond inputs", () => {
    it("preserves the sub-millisecond remainder", () => {
      // Exactly representable at this magnitude; the collector's timestamp
      // validators accept non-integer milliseconds.
      expect(epochMsToOtlpNanos(1_757_400_000_000.125)).toBe(
        "1757400000000125000",
      );
      expect(epochMsToOtlpNanos(1_757_400_000_000.375)).toBe(
        "1757400000000375000",
      );
    });

    it("keeps a 0.25ms span from collapsing to zero duration", () => {
      const start = BigInt(epochMsToOtlpNanos(1_757_400_000_000.125));
      const end = BigInt(epochMsToOtlpNanos(1_757_400_000_000.375));

      expect(end - start).toBe(250_000n);
    });

    it("carries a remainder that rounds up into the next millisecond", () => {
      expect(epochMsToOtlpNanos(1_757_400_000_000.9999999)).toBe(
        "1757400000001000000",
      );
    });
  });

  describe("given zero", () => {
    it("stays zero", () => {
      expect(epochMsToOtlpNanos(0)).toBe("0");
    });
  });
});
