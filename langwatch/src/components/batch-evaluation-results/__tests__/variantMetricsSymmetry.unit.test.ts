import { describe, expect, it } from "vitest";

import { computeVariantMetrics } from "../computeVariantMetrics";
import type { BatchResultRow } from "../types";

/**
 * The paired cost/duration intervals decide dominance, and dominance is a
 * statement about an unordered pair. If asking "is a cheaper than b" and "is
 * b cheaper than a" can give answers that are not mirror images, the same run
 * can report a beats b AND b beats a.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

const rowsWith = (
  perVariant: Record<string, Array<{ cost: number; duration: number }>>,
): BatchResultRow[] => {
  const ids = Object.keys(perVariant);
  const length = Math.max(...ids.map((id) => perVariant[id]!.length));
  return Array.from({ length }, (_, i) => ({
    index: i,
    entry: {},
    targets: Object.fromEntries(
      ids.map((id) => {
        const point = perVariant[id]![i];
        return [
          id,
          {
            targetId: id,
            output: {},
            cost: point?.cost ?? null,
            duration: point?.duration ?? null,
            error: null,
            traceId: null,
            evaluatorResults: [],
          },
        ];
      }),
    ),
  })) as unknown as BatchResultRow[];
};

/** Costs a hair apart, so the interval sits near zero where sign matters. */
const nearlyEqual = (base: number, jitter: number[], durationBase: number) =>
  jitter.map((j) => ({ cost: base + j, duration: durationBase + j * 1000 }));

describe("computeVariantMetrics — paired difference intervals", () => {
  const rows = rowsWith({
    a: nearlyEqual(
      0.002,
      [0.0001, -0.0002, 0.00005, -0.0001, 0.0003, -0.00015, 0.0002, -0.00005],
      1000,
    ),
    b: nearlyEqual(
      0.00205,
      [-0.0002, 0.0003, -0.00005, 0.0002, -0.0001, 0.00025, -0.0003, 0.0001],
      1050,
    ),
  });

  describe("given a pair asked in both directions", () => {
    it("returns exact mirror images for cost", () => {
      // Otherwise dominance is not a property of the pair, and the two
      // orderings can disagree about who is cheaper.
      const metrics = computeVariantMetrics({ variantIds: ["a", "b"], rows });
      const ab = metrics.a!.costDifferenceCI.b!;
      const ba = metrics.b!.costDifferenceCI.a!;

      expect(ba[0]).toBeCloseTo(-ab[1], 12);
      expect(ba[1]).toBeCloseTo(-ab[0], 12);
    });

    it("returns exact mirror images for duration", () => {
      const metrics = computeVariantMetrics({ variantIds: ["a", "b"], rows });
      const ab = metrics.a!.durationDifferenceCI.b!;
      const ba = metrics.b!.durationDifferenceCI.a!;

      expect(ba[0]).toBeCloseTo(-ab[1], 9);
      expect(ba[1]).toBeCloseTo(-ab[0], 9);
    });

    /** @scenario "Asking about a pair in either order gives the same answer" */
    it("never lets both directions claim the other is cheaper", () => {
      const metrics = computeVariantMetrics({ variantIds: ["a", "b"], rows });
      const ab = metrics.a!.costDifferenceCI.b!;
      const ba = metrics.b!.costDifferenceCI.a!;

      const aCheaper = ab[1] < 0;
      const bCheaper = ba[1] < 0;
      expect(aCheaper && bCheaper).toBe(false);

      // And the two must agree on whether there is any difference at all.
      const abSeparates = ab[1] < 0 || ab[0] > 0;
      const baSeparates = ba[1] < 0 || ba[0] > 0;
      expect(abSeparates).toBe(baSeparates);
    });
  });

  describe("given the variants share too few priced rows", () => {
    /** @scenario "Two variants that share too few rows are not compared on cost" */
    it("declines to produce an interval from a couple of points", () => {
      // Each variant is priced on enough rows to clear the per-variant floor,
      // but they barely overlap, so the PAIRED sample is tiny. A dominance
      // claim resting on two shared rows is the same defect the per-variant
      // floor exists to prevent.
      const sparse = rowsWith({
        a: [
          { cost: 0.001, duration: 100 },
          { cost: 0.001, duration: 100 },
          { cost: 0.001, duration: 100 },
          { cost: 0.001, duration: 100 },
          { cost: 0.001, duration: 100 },
          { cost: 0.001, duration: 100 },
        ],
        b: [
          { cost: 0.009, duration: 900 },
          { cost: 0.009, duration: 900 },
        ],
      });

      const metrics = computeVariantMetrics({
        variantIds: ["a", "b"],
        rows: sparse,
      });

      expect(metrics.a!.costDifferenceCI.b).toBeUndefined();
    });
  });
});
