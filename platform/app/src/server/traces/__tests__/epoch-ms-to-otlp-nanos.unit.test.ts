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

  describe("given a fractional millisecond input", () => {
    it("rounds to the nearest millisecond before converting", () => {
      expect(epochMsToOtlpNanos(1_757_400_000_000.6)).toBe(
        "1757400000001000000",
      );
      expect(epochMsToOtlpNanos(1_757_400_000_000.4)).toBe(
        "1757400000000000000",
      );
    });
  });

  describe("given zero", () => {
    it("stays zero", () => {
      expect(epochMsToOtlpNanos(0)).toBe("0");
    });
  });
});
