import { describe, expect, it } from "vitest";

import { bootstrapMeanCI } from "../bootstrapMeanCI";

/**
 * The horizontal arm of the trade-off chart's error cross. It has to mean the
 * same thing as the vertical one — "where the true mean lies" — or the glyph
 * is two different statements wearing one shape.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

describe("bootstrapMeanCI", () => {
  describe("given a spread of values", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    it("brackets the sample mean", () => {
      const ci = bootstrapMeanCI({ values })!;
      const mean = values.reduce((s, v) => s + v, 0) / values.length;

      expect(ci[0]).toBeLessThan(mean);
      expect(ci[1]).toBeGreaterThan(mean);
    });

    /** @scenario "The cost axis carries its uncertainty too" */
    it("is narrower than the spread of the values themselves", () => {
      // The distinction the whole module rests on: this is the uncertainty of
      // the MEAN, not the range of the rows. Confusing the two would draw an
      // arm several times too wide.
      const ci = bootstrapMeanCI({ values })!;
      const dataRange = Math.max(...values) - Math.min(...values);

      expect(ci[1] - ci[0]).toBeLessThan(dataRange);
    });

    it("returns the same interval for the same seed", () => {
      expect(bootstrapMeanCI({ values, seed: 7 })).toEqual(
        bootstrapMeanCI({ values, seed: 7 }),
      );
    });

    it("narrows as the sample grows", () => {
      const wide = bootstrapMeanCI({ values })!;
      const many = Array.from({ length: 400 }, (_, i) => (i % 10) + 1);
      const narrow = bootstrapMeanCI({ values: many })!;

      expect(narrow[1] - narrow[0]).toBeLessThan(wide[1] - wide[0]);
    });
  });

  describe("given a single observation", () => {
    /** @scenario "A cost averaged over a single row admits it cannot be bounded" */
    it("refuses to produce an interval", () => {
      // Every replicate would be that one value, so the interval comes out
      // zero-width and reads as certainty about a mean drawn from one row.
      expect(bootstrapMeanCI({ values: [0.004] })).toBeNull();
    });
  });

  describe("given no observations", () => {
    it("refuses to produce an interval", () => {
      expect(bootstrapMeanCI({ values: [] })).toBeNull();
    });
  });

  describe("given a non-finite value", () => {
    it("refuses rather than propagating it into the interval", () => {
      expect(bootstrapMeanCI({ values: [1, 2, NaN] })).toBeNull();
      expect(bootstrapMeanCI({ values: [1, 2, Infinity] })).toBeNull();
    });
  });

  describe("given identical values", () => {
    it("returns a zero-width interval, because there is genuinely no spread", () => {
      // Distinct from the single-observation case: here the run really did
      // observe the same cost repeatedly, and reporting no uncertainty is
      // the correct reading rather than a false one.
      const ci = bootstrapMeanCI({ values: [0.002, 0.002, 0.002, 0.002] })!;

      expect(ci[0]).toBeCloseTo(0.002, 12);
      expect(ci[1]).toBeCloseTo(0.002, 12);
    });
  });

  describe("given a right-skewed cost distribution", () => {
    it("keeps the interval above zero", () => {
      // The reason this is a bootstrap and not mean ± 1.96·SE. Costs pile up
      // near a floor with a long tail, and the normal approximation happily
      // puts the lower bound below zero, which is not a possible cost.
      const skewed = [0.0001, 0.0001, 0.0002, 0.0001, 0.0002, 0.0001, 0.0001, 0.05];
      const ci = bootstrapMeanCI({ values: skewed })!;

      expect(ci[0]).toBeGreaterThan(0);
    });
  });
});
