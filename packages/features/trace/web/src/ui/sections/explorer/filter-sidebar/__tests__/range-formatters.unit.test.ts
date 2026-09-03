import { describe, expect, it } from "vitest";
import { getRangeFormatter } from "../utils";

/**
 * Range facet endpoints render a bare slider with min/max numbers and no
 * per-endpoint header to carry the unit — "16 / 575" is ambiguous on its
 * own. Each numeric facet therefore stamps a compact unit suffix. These
 * tests pin the unit per facet so the labels can't silently drift back to
 * unitless numbers.
 */
describe("getRangeFormatter", () => {
  describe("when the facet measures duration (ms)", () => {
    it("renders ms below a second and s above", () => {
      const fmt = getRangeFormatter("duration");
      expect(fmt(205)).toBe("205ms");
      expect(fmt(31_500)).toBe("31.5s");
    });

    it("applies the same ms/s format to ttft and ttlt", () => {
      expect(getRangeFormatter("ttft")(205)).toBe("205ms");
      expect(getRangeFormatter("ttlt")(2_000)).toBe("2.0s");
    });
  });

  describe("when the facet measures spend (cost)", () => {
    it("prefixes a dollar sign", () => {
      expect(getRangeFormatter("cost")(0.05)).toBe("$0.0500");
    });
  });

  describe("when the facet counts tokens", () => {
    it("suffixes a compact `tok` unit on total / prompt / completion tokens", () => {
      for (const key of ["tokens", "promptTokens", "completionTokens"]) {
        const fmt = getRangeFormatter(key);
        expect(fmt(205), key).toBe("205 tok");
        expect(fmt(31_500), key).toBe("31.5K tok");
      }
    });
  });

  describe("when the facet measures throughput (tokens / second)", () => {
    it("suffixes `/s`", () => {
      const fmt = getRangeFormatter("tokensPerSecond");
      expect(fmt(575)).toBe("575/s");
      expect(fmt(1_200)).toBe("1.2K/s");
    });
  });

  describe("when the facet counts spans", () => {
    it("suffixes a `spans` unit and singularises one span", () => {
      const fmt = getRangeFormatter("spans");
      expect(fmt(1)).toBe("1 span");
      expect(fmt(16)).toBe("16 spans");
    });
  });

  describe("when the facet measures stored payload size (bytes)", () => {
    it("humanises bytes with SI units", () => {
      const fmt = getRangeFormatter("size");
      expect(fmt(512)).toBe("512 B");
      expect(fmt(1_400_000)).toBe("1.4 MB");
    });
  });

  describe("when the facet has no registered unit", () => {
    it("falls back to a rounded integer", () => {
      expect(getRangeFormatter("promptVersion")(3.4)).toBe("3");
    });
  });
});
