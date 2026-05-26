import { describe, expect, it } from "vitest";

import {
  capComputedIO,
  COMPUTED_IO_MAX_BYTES,
} from "../traceSummary.foldProjection";

describe("capComputedIO", () => {
  describe("given computed input and output within the limit", () => {
    it("returns them unchanged and reports no truncation", () => {
      const result = capComputedIO("hello", "world");
      expect(result.computedInput).toBe("hello");
      expect(result.computedOutput).toBe("world");
      expect(result.computedIOTruncated).toBe(false);
    });

    it("passes nulls through untouched", () => {
      const result = capComputedIO(null, null);
      expect(result.computedInput).toBeNull();
      expect(result.computedOutput).toBeNull();
      expect(result.computedIOTruncated).toBe(false);
    });
  });

  describe("given computed input and output exceeding the maximum length", () => {
    /** @scenario 'Computed input and output are capped to a maximum length' */
    it("truncates each to the byte budget and marks the truncation", () => {
      const huge = "a".repeat(COMPUTED_IO_MAX_BYTES * 2);
      const result = capComputedIO(huge, huge);

      expect(result.computedIOTruncated).toBe(true);
      expect(
        Buffer.byteLength(result.computedInput ?? "", "utf8"),
      ).toBeLessThanOrEqual(COMPUTED_IO_MAX_BYTES);
      expect(
        Buffer.byteLength(result.computedOutput ?? "", "utf8"),
      ).toBeLessThanOrEqual(COMPUTED_IO_MAX_BYTES);
      expect(result.computedInput?.endsWith("[truncated]")).toBe(true);
    });

    it("respects the budget even for multibyte content", () => {
      // 4-byte emoji repeated past the budget — naive char slicing would
      // overshoot the byte budget, so the byte-aware trim must hold.
      const emoji = "😀".repeat(COMPUTED_IO_MAX_BYTES);
      const result = capComputedIO(emoji, null);
      expect(result.computedIOTruncated).toBe(true);
      expect(
        Buffer.byteLength(result.computedInput ?? "", "utf8"),
      ).toBeLessThanOrEqual(COMPUTED_IO_MAX_BYTES);
    });
  });
});
