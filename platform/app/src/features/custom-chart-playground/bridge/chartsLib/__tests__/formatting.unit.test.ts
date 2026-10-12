/**
 * `format`/`formatAxisValue` wiring: a widget declaring `format="percent"`
 * or `"currency"` gets a unit on its axis ticks and tooltip values, not a
 * bare number. Langy shipped a chart with `yUnit="$"` (not a real prop) and
 * got no unit anywhere — this is the real prop the fix routes through.
 *
 * @see specs/analytics/custom-chart-playground.feature
 */

import { describe, expect, it } from "vitest";

import { formatAxisValue, formatValue } from "../index";

describe("formatValue", () => {
  describe("when format is currency", () => {
    it("prefixes with $", () => {
      expect(formatValue(1410, "currency")).toBe("$1,410");
    });
  });

  describe("when format is percent", () => {
    it("multiplies by 100 and suffixes with %", () => {
      expect(formatValue(0.141, "percent")).toBe("14.1%");
    });
  });

  describe("when format is duration", () => {
    it("shortens to the nearest unit", () => {
      expect(formatValue(1500, "duration")).toBe("1.5s");
    });
  });

  describe("when no format is given", () => {
    it("formats as a plain number", () => {
      expect(formatValue(1410)).toBe("1,410");
    });
  });

  describe("when the value is missing", () => {
    it("renders a dash rather than throwing", () => {
      expect(formatValue(null)).toBe("–");
      expect(formatValue(undefined, "currency")).toBe("–");
    });
  });
});

describe("formatAxisValue", () => {
  describe("when format is currency", () => {
    it("prefixes the compact number with $", () => {
      expect(formatAxisValue(1500, "currency")).toBe("$1.5K");
    });
  });

  describe("when format is percent", () => {
    it("multiplies by 100 and suffixes with %", () => {
      expect(formatAxisValue(0.141, "percent")).toBe("14.1%");
    });
  });

  describe("when format is duration", () => {
    it("shortens to the nearest unit", () => {
      expect(formatAxisValue(1500, "duration")).toBe("1.5s");
    });
  });

  describe("when no format is given", () => {
    it("falls back to a plain compact number", () => {
      expect(formatAxisValue(1500)).toBe("1.5K");
    });
  });

  describe("when the value is missing", () => {
    it("renders an empty tick rather than throwing", () => {
      expect(formatAxisValue(null)).toBe("");
      expect(formatAxisValue(undefined, "percent")).toBe("");
    });
  });
});
