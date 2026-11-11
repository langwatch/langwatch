import { quantile } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import {
  bootstrapMeanCI,
  bootstrapPairedDifferenceCIs,
  mulberry32,
  percentileInterval95,
} from "../model/batch-evaluation-results.bootstrap-ci.ts";

/** Right-skewed, cost-like values: a floor with a long tail. */
const skewedValues = (count: number, seed: number, scale = 0.01): number[] => {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => 0.0001 + rand() ** 4 * scale);
};

/** The interval as it was computed before: a fresh generator, a full sort, `quantile`. */
const sortedReferenceCI = (values: number[], seed: number): [number, number] => {
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let b = 0; b < 1000; b++) {
    let total = 0;
    for (let k = 0; k < values.length; k++) total += values[Math.floor(rand() * values.length)]!;
    means.push(total / values.length);
  }
  means.sort((a, b) => a - b);
  return [quantile(means, 0.025), quantile(means, 0.975)];
};

/**
 * The horizontal arm of the trade-off chart's error cross.
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
      expect(bootstrapMeanCI({ values, seed: 7 })).toEqual(bootstrapMeanCI({ values, seed: 7 }));
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

  describe("given the generator and selection written out for speed", () => {
    it("returns the interval the sorted reference returns, to the last digit", () => {
      // The resampling stream and the quantiles must not move: a run's cost
      // interval is the same today as it was when the reader last looked.
      for (const [count, seed] of [
        [2, 1],
        [8, 7],
        [200, 3],
        [1000, 2166136261],
      ] as const) {
        const values = skewedValues(count, seed + 11);
        expect(bootstrapMeanCI({ values, seed })).toEqual(sortedReferenceCI(values, seed));
      }
    });
  });
});

describe("percentileInterval95", () => {
  it("matches a full sort and the contract's quantile, ties included", () => {
    const rand = mulberry32(5);
    for (let length = 1; length <= 60; length++) {
      // Rounded so many values repeat, which is where a selection goes wrong.
      const values = Array.from({ length }, () => Math.round(rand() * 10) - 5);
      const sorted = values.toSorted((a, b) => a - b);

      expect(percentileInterval95(Float64Array.from(values))).toEqual([
        quantile(sorted, 0.025),
        quantile(sorted, 0.975),
      ]);
    }
  });

  it("returns null for no replicates", () => {
    expect(percentileInterval95(new Float64Array(0))).toBeNull();
  });
});

/**
 * Same paired bootstrap, one resampling shared by every pair: only Monte Carlo noise
 * may differ (about 3% of the width per bound between two seeds). Tolerance: each
 * bound within 15% of the per-pair interval's width, widths within 10% of each other.
 */
describe("bootstrapPairedDifferenceCIs", () => {
  /** How far the shared interval sits from the per-pair one, in per-pair widths. */
  const gapBetween = (shared: [number, number], perPair: [number, number]) => {
    const width = perPair[1] - perPair[0];
    return {
      boundShift:
        Math.max(Math.abs(shared[0] - perPair[0]), Math.abs(shared[1] - perPair[1])) / width,
      widthRatio: (shared[1] - shared[0]) / width,
    };
  };

  describe("given two variants that recorded every row", () => {
    it("agrees with resampling the pair's differences on their own", () => {
      for (const [rows, seed] of [
        [12, 1],
        [60, 2],
        [300, 3],
        [1000, 4],
      ] as const) {
        const a = skewedValues(rows, seed);
        const b = skewedValues(rows, seed + 100, 0.012);

        const [shared] = bootstrapPairedDifferenceCIs({ columns: [a, b], pairs: [[0, 1]] });
        const perPair = bootstrapMeanCI({
          values: a.map((value, r) => value - b[r]!),
          seed: seed + 1000,
        });

        const { boundShift, widthRatio } = gapBetween(shared!, perPair!);
        expect(boundShift).toBeLessThan(0.15);
        expect(widthRatio).toBeGreaterThan(0.9);
        expect(widthRatio).toBeLessThan(1.1);
      }
    });
  });

  describe("given variants that each missed a few rows", () => {
    it("agrees with resampling the rows the pair shares on their own", () => {
      for (const [rows, seed] of [
        [100, 5],
        [500, 6],
      ] as const) {
        const rand = mulberry32(seed + 7);
        const drop = (values: number[]) => values.map((v) => (rand() < 0.04 ? null : v));
        // A clear gap between the two, so miscounting the rows a pair can use
        // would move the interval by far more than the noise.
        const a = drop(skewedValues(rows, seed).map((v) => v + 0.01));
        const b = drop(skewedValues(rows, seed + 100, 0.012));

        const [shared] = bootstrapPairedDifferenceCIs({ columns: [a, b], pairs: [[0, 1]] });
        const differences: number[] = [];
        a.forEach((value, r) => {
          if (value !== null && b[r] !== null) differences.push(value - b[r]!);
        });
        const perPair = bootstrapMeanCI({ values: differences, seed: seed + 1000 });

        const { boundShift, widthRatio } = gapBetween(shared!, perPair!);
        expect(boundShift).toBeLessThan(0.15);
        expect(widthRatio).toBeGreaterThan(0.9);
        expect(widthRatio).toBeLessThan(1.1);
      }
    });
  });

  it("gives a pair the same interval whichever other variants are in the run", () => {
    // Adding a variant, even one with gaps of its own, must not move the
    // interval between two others.
    const a = skewedValues(200, 1);
    const b = skewedValues(200, 2);
    const c = skewedValues(200, 3).map((v, r) => (r % 7 === 0 ? null : v));

    const alone = bootstrapPairedDifferenceCIs({ columns: [a, b], pairs: [[0, 1]] });
    const inCompany = bootstrapPairedDifferenceCIs({
      columns: [a, b, c],
      pairs: [
        [0, 1],
        [0, 2],
        [1, 2],
      ],
    });

    expect(inCompany[0]).toEqual(alone[0]);
  });

  it("returns the same intervals for the same seed", () => {
    const columns = [skewedValues(50, 1), skewedValues(50, 2), skewedValues(50, 3)];
    const pairs: [number, number][] = [
      [0, 1],
      [1, 2],
    ];

    expect(bootstrapPairedDifferenceCIs({ columns, pairs, seed: 9 })).toEqual(
      bootstrapPairedDifferenceCIs({ columns, pairs, seed: 9 }),
    );
  });

  it("orients each interval as the first variant minus the second", () => {
    const cheap = Array.from({ length: 40 }, (_, r) => 0.001 + (r % 5) * 0.0001);
    const dear = cheap.map((v) => v + 0.01);

    const [cheapMinusDear, dearMinusCheap] = bootstrapPairedDifferenceCIs({
      columns: [cheap, dear],
      pairs: [
        [0, 1],
        [1, 0],
      ],
    });

    expect(cheapMinusDear![1]).toBeLessThan(0);
    expect(dearMinusCheap![0]).toBeGreaterThan(0);
  });
});
