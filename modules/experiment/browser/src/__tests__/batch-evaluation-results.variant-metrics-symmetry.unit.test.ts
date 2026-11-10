import { describe, expect, it } from "vitest";

import type { BatchResultRow } from "../ui/sections/batch-evaluation-results.types.ts";
import { computeVariantMetrics } from "../ui/sections/batch-evaluation-results.variant-metrics.ts";

/**
 * The paired cost/duration intervals decide dominance, and dominance is a statement
 * about an unordered pair.
 * @see specs/experiments/comparison-leaderboard.feature
 */

const rowsWith = (
  perVariant: Record<string, ({ cost: number; duration: number } | undefined)[]>,
): BatchResultRow[] => {
  const ids = Object.keys(perVariant);
  const length = Math.max(...ids.map((id) => perVariant[id]!.length));
  return Array.from({ length }, (_, i): BatchResultRow => ({
    index: i,
    datasetEntry: {},
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
  }));
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

  describe("given pairs on either side of the shared-resampling overlap", () => {
    /** Twenty rows with spread, so an interval has width and its seed shows in it. */
    const spread = (base: number) =>
      Array.from({ length: 20 }, (_, i) => ({
        // The pattern depends on the base too, so two variants' differences vary by row.
        cost: base + ((i * Math.round(base * 1000 + 4)) % 11) * 0.0001,
        duration: base * 1e6 + ((i * 5) % 13) * 10,
      }));
    /** The same rows with the last `gaps` unrecorded. */
    const withGaps = (base: number, gaps: number) =>
      spread(base).map((point, i) => (i >= 20 - gaps ? undefined : point));

    const costGap = (
      perVariant: Record<string, ({ cost: number; duration: number } | undefined)[]>,
    ) => {
      const [left, right] = Object.keys(perVariant);
      return computeVariantMetrics({
        variantIds: Object.keys(perVariant),
        rows: rowsWith(perVariant),
      })[left!]!.costDifferenceCI[right!]!;
    };
    /** The shared draw is seeded per metric, a pair's own draw by its variant ids. */
    const movesWhenRenamed = (gaps: number) => {
      const first = costGap({ a: spread(0.002), b: withGaps(0.003, gaps) });
      const renamed = costGap({ x: spread(0.002), y: withGaps(0.003, gaps) });
      return first[0] !== renamed[0] || first[1] !== renamed[1];
    };

    describe("when the pair shares exactly 90% of the run's rows", () => {
      it("joins the shared resampling", () => {
        expect(movesWhenRenamed(2)).toBe(false);
      });
    });

    describe("when the pair shares just under 90% of the run's rows", () => {
      it("is resampled on its own", () => {
        expect(movesWhenRenamed(3)).toBe(true);
      });
    });

    /** @scenario "A pair's cost interval does not move when another variant joins the run" */
    it("keeps a pair's interval when an unrelated variant joins the run", () => {
      // c and sparse recorded rows a and b both missed; the pair's interval reads
      // only its own two variants, so neither may move it.
      const a = withGaps(0.002, 1);
      const b = withGaps(0.003, 1);
      const c = spread(0.004);
      const sparse = spread(0.005).map((point, i) => (i < 2 ? point : undefined));

      const alone = costGap({ a, b });
      expect(costGap({ a, b, c })).toEqual(alone);
      expect(costGap({ a, b, sparse })).toEqual(alone);
    });
  });
});
