import { describe, expect, it } from "vitest";
import { formatBytes } from "../formatters";

/**
 * `formatBytes` humanises the trace's stored payload size (`_size_bytes` on
 * trace_summaries) for the Storage size column + facet. Decimal (SI) units,
 * one decimal place from kB up, em-dash for empty.
 */
describe("formatBytes", () => {
  describe("given a sub-kilobyte size", () => {
    it("renders a plain integer in bytes", () => {
      expect(formatBytes(512)).toBe("512 B");
    });

    it("rounds fractional bytes to a whole number", () => {
      expect(formatBytes(999.4)).toBe("999 B");
    });

    it("renders 1 byte without a decimal", () => {
      expect(formatBytes(1)).toBe("1 B");
    });
  });

  describe("given a kilobyte-scale size", () => {
    it("switches to kB at exactly 1000 bytes", () => {
      expect(formatBytes(1_000)).toBe("1.0 kB");
    });

    it("renders kB with one decimal place", () => {
      expect(formatBytes(12_345)).toBe("12.3 kB");
    });
  });

  describe("given a megabyte-scale size", () => {
    it("switches to MB past a million bytes", () => {
      expect(formatBytes(1_400_000)).toBe("1.4 MB");
    });
  });

  describe("given a gigabyte-scale size", () => {
    it("switches to GB past a billion bytes", () => {
      expect(formatBytes(2_500_000_000)).toBe("2.5 GB");
    });
  });

  describe("given a very large size beyond the largest unit", () => {
    it("caps at the terabyte unit rather than overflowing the table", () => {
      // 5 PB-worth of bytes still renders in TB (the largest unit) instead of
      // running off the end of the unit ladder.
      expect(formatBytes(5_000_000_000_000_000)).toBe("5000.0 TB");
    });
  });

  describe("given an empty / non-positive / non-finite size", () => {
    it("renders an em-dash for zero so the column reads as empty", () => {
      expect(formatBytes(0)).toBe("—");
    });

    it("renders an em-dash for a negative size", () => {
      expect(formatBytes(-1)).toBe("—");
    });

    it("renders an em-dash for NaN", () => {
      expect(formatBytes(Number.NaN)).toBe("—");
    });

    it("renders an em-dash for Infinity", () => {
      expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
    });
  });
});
