/**
 * The heatmap colour ramp. `colorScale` is author-supplied and Babel-compiled
 * in the sandbox with no type checking, so a 3-digit CSS shorthand (`#abc`)
 * reaches the ramp as ordinary input — it must expand, not silently blank the
 * cell with `rgb(NaN, NaN, NaN)`.
 *
 * @see specs/analytics/custom-chart-playground.feature
 */

import { describe, expect, it } from "vitest";

import { interpolateColor, parseHexRgb } from "../index";

describe("parseHexRgb", () => {
  describe("when given a 6-digit hex", () => {
    it("parses it to an r, g, b triple", () => {
      expect(parseHexRgb("#4338ca")).toEqual([0x43, 0x38, 0xca]);
    });
  });

  describe("when given a 3-digit shorthand", () => {
    it("expands each nibble rather than producing NaN", () => {
      expect(parseHexRgb("#abc")).toEqual([0xaa, 0xbb, 0xcc]);
    });
  });

  describe("when given something unparsable", () => {
    it("returns null", () => {
      expect(parseHexRgb("not-a-color")).toBeNull();
      expect(parseHexRgb("#12")).toBeNull();
    });
  });
});

describe("interpolateColor", () => {
  describe("when both ends are 3-digit shorthand", () => {
    it("returns a real rgb() colour, never NaN", () => {
      const color = interpolateColor("#abc", "#4338ca", 0.5);
      expect(color).not.toContain("NaN");
      expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    });
  });

  describe("when an end is unparsable", () => {
    it("falls back to the default scale instead of blanking the cell", () => {
      const color = interpolateColor("garbage", "#4338ca", 0);
      // t=0 pins the output to the `from` end; the fallback is #eef2ff.
      expect(color).toBe("rgb(238, 242, 255)");
    });
  });
});
