/**
 * The quantile both confidence intervals are read from.
 *
 * The bootstrap CI and the Bradley-Terry leaderboard each draw a 95% interval
 * by asking for the 2.5th and 97.5th percentile of a resample. They had a copy
 * of this each, identical, which is two intervals over the same data that can
 * come to disagree.
 *
 * The interpolation is the part worth pinning. A bootstrap of 1,000 resamples
 * puts the 2.5th percentile at position 24.975 — between two samples — and
 * snapping to a neighbour instead of interpolating shifts the published bound
 * by a whole sample. Removing it left every test in the package green.
 */

import { describe, expect, it } from "vitest";
import { quantile } from "../batch-evaluation-results.metric-stats";

describe("quantile", () => {
  describe("given a position that lands between two samples", () => {
    it("interpolates linearly rather than snapping to a neighbour", () => {
      // 0.5 of [0, 10] is position 0.5 — exactly between them.
      expect(quantile([0, 10], 0.5)).toBe(5);
      // A quarter of the way from 0 to 10.
      expect(quantile([0, 10], 0.25)).toBe(2.5);
    });

    it("weights the nearer sample more heavily", () => {
      expect(quantile([0, 100], 0.9)).toBeCloseTo(90, 10);
    });
  });

  describe("given a position that lands exactly on a sample", () => {
    it("answers that sample", () => {
      expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
      expect(quantile([1, 2, 3], 0)).toBe(1);
      expect(quantile([1, 2, 3], 1)).toBe(3);
    });
  });

  describe("the bounds a 95% interval asks for", () => {
    it("stays inside the sample at both ends", () => {
      const sorted = Array.from({ length: 1000 }, (_, i) => i);

      const lo = quantile(sorted, 0.025);
      const hi = quantile(sorted, 0.975);

      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(999);
      expect(lo).toBeLessThan(hi);
    });

    it("is symmetric about the middle for a symmetric sample", () => {
      const sorted = Array.from({ length: 1001 }, (_, i) => i - 500);

      expect(quantile(sorted, 0.025)).toBeCloseTo(-quantile(sorted, 0.975), 10);
    });
  });

  describe("given a sample too small to interpolate", () => {
    it("answers the only value, whatever quantile was asked for", () => {
      expect(quantile([7], 0)).toBe(7);
      expect(quantile([7], 0.5)).toBe(7);
      expect(quantile([7], 1)).toBe(7);
    });

    it("answers zero for an empty sample rather than NaN", () => {
      // A NaN bound renders as a blank axis with no explanation; zero is at
      // least a number the caller can notice.
      expect(quantile([], 0.5)).toBe(0);
    });
  });
});
