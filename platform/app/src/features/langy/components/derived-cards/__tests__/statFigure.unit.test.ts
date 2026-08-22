/**
 * @see specs/langy/langy-derived-stats-presentation.feature
 */
import { describe, expect, it } from "vitest";
import {
  formatStatFigure,
  isComparableSeries,
  resolveStatUnit,
} from "../statFigure";

describe("formatStatFigure", () => {
  describe("given a unit word with a canonical symbol", () => {
    /** @scenario "A unit word is drawn as the symbol a reader expects" */
    it("draws the symbol tight against the number", () => {
      expect(formatStatFigure({ value: 35, unit: "percent" })).toBe("35%");
      expect(formatStatFigure({ value: 45, unit: "Percent" })).toBe("45%");
      expect(formatStatFigure({ value: 45, unit: "percentage" })).toBe("45%");
      expect(formatStatFigure({ value: 45, unit: "pct" })).toBe("45%");
    });
  });

  describe("given a unit that is a plain word", () => {
    /** @scenario "A unit that is a word stands off the number" */
    it("separates it from the number with a space", () => {
      expect(formatStatFigure({ value: 812, unit: "ms" })).toBe("812 ms");
      expect(formatStatFigure({ value: 1500, unit: "tokens" })).toBe(
        "1,500 tokens",
      );
    });
  });

  describe("given a unit that is already a symbol", () => {
    /** @scenario "A unit that is already a symbol is left alone" */
    it("draws it as written with no space", () => {
      expect(formatStatFigure({ value: 85, unit: "%" })).toBe("85%");
      expect(formatStatFigure({ value: 12, unit: "°" })).toBe("12°");
    });
  });

  describe("given no unit", () => {
    it("draws the number alone", () => {
      expect(formatStatFigure({ value: 1204 })).toBe("1,204");
      expect(formatStatFigure({ value: 1204, unit: "   " })).toBe("1,204");
    });
  });

  describe("given a value that is already text", () => {
    it("leaves the text as written", () => {
      expect(formatStatFigure({ value: "n/a" })).toBe("n/a");
    });
  });
});

describe("resolveStatUnit", () => {
  it("reports nothing for an absent or blank unit", () => {
    expect(resolveStatUnit(undefined)).toBeUndefined();
    expect(resolveStatUnit("")).toBeUndefined();
    expect(resolveStatUnit("  ")).toBeUndefined();
  });
});

describe("isComparableSeries", () => {
  describe("given numeric readings sharing one unit", () => {
    /** @scenario "Readings on one scale are a comparison" */
    it("reads them as a comparison", () => {
      expect(
        isComparableSeries([
          { value: 35, unit: "percent" },
          { value: 45, unit: "percent" },
        ]),
      ).toBe(true);
    });

    it("reads unitless numbers on one scale as a comparison too", () => {
      expect(isComparableSeries([{ value: 3 }, { value: 9 }])).toBe(true);
    });

    /** @scenario "Readings whose unit words draw the same symbol are one scale" */
    it("reads unit words that draw the same symbol as one scale", () => {
      expect(
        isComparableSeries([
          { value: 35, unit: "percent" },
          { value: 45, unit: "pct" },
        ]),
      ).toBe(true);
      expect(
        isComparableSeries([
          { value: 35, unit: "%" },
          { value: 45, unit: "percentage" },
        ]),
      ).toBe(true);
    });
  });

  describe("given readings that share no scale", () => {
    /** @scenario "Readings that share no scale are not a comparison" */
    it("refuses a comparison across different units", () => {
      expect(
        isComparableSeries([
          { value: 35, unit: "percent" },
          { value: 812, unit: "ms" },
        ]),
      ).toBe(false);
    });

    /** @scenario "Readings that share no scale are not a comparison" */
    it("refuses a comparison when a reading is text", () => {
      expect(
        isComparableSeries([
          { value: 35, unit: "percent" },
          { value: "n/a", unit: "percent" },
        ]),
      ).toBe(false);
    });
  });

  describe("given a single reading", () => {
    /** @scenario "A single reading is not a comparison" */
    it("has nothing to compare it against", () => {
      expect(isComparableSeries([{ value: 35, unit: "percent" }])).toBe(false);
      expect(isComparableSeries([])).toBe(false);
    });
  });
});
