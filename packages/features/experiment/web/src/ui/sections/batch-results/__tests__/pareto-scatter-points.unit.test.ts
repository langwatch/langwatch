import { describe, expect, it } from "vitest";

import { buildParetoPoints } from "../pareto-scatter-chart";
import type { BTLeaderboardEntry } from "../../../../model/batch-evaluation-results.bt-leaderboard";
import type { MetricStats } from "../../../../model/batch-evaluation-results.metric-stats";
import type { VariantMetrics } from "../../batch-evaluation-results.variant-metrics";

/**
 * What the trade-off chart is allowed to draw.
 * @see specs/experiments/comparison-leaderboard.feature
 */

const AXIS = {
  xAxisMetric: "cost" as const,
  sizeMetric: "duration" as const,
  formatX: (v: number) => String(v),
  formatSize: (v: number) => String(v),
  xLabel: "Avg cost",
  sizeLabel: "avg duration",
};

const entry = (variantId: string, score: number, isDegenerate = false): BTLeaderboardEntry => ({
  variantId,
  wins: 5,
  losses: 5,
  matchups: 10,
  winRate: 0.5,
  strength: 1,
  score,
  scoreCI: [score - 10, score + 10] as [number, number],
  isDegenerate,
});

const metricStats = (average: number): MetricStats => ({
  min: average,
  max: average,
  avg: average,
  median: average,
  p75: average,
  p90: average,
  p95: average,
  p99: average,
  total: average * 20,
  count: 20,
});

const metricsFor = (ids: string[]): Record<string, VariantMetrics> =>
  Object.fromEntries(
    ids.map((id) => [
      id,
      {
        variantId: id,
        costStats: metricStats(0.01),
        durationStats: metricStats(500),
        costMeanCI: null,
        durationMeanCI: null,
        costDifferenceCI: {},
        durationDifferenceCI: {},
      },
    ]),
  );

describe("buildParetoPoints", () => {
  describe("given a variant that swept every matchup", () => {
    /**
     * `computeParetoDominance` excludes degenerates because "their score is not a
     * measurement", the table labels them, and the trust panel says they are excluded
     * from the ranking.
     */
    it("does not plot it as a live option", () => {
      const points = buildParetoPoints({
        entries: [entry("sweeper", 476, true), entry("a", -238), entry("b", -238)],
        variantMetrics: metricsFor(["sweeper", "a", "b"]),
        variantNames: { sweeper: "Sweeper", a: "A", b: "B" },
        targetColors: undefined,
        axis: AXIS,
        dominance: { dimensions: [], dominatedBy: {}, front: [], edges: [] },
      });

      expect(points.map((p) => p.variantId)).toEqual(["a", "b"]);
    });
  });

  describe("given every variant both won and lost", () => {
    it("plots all of them, so the guard above is not simply refusing everything", () => {
      const points = buildParetoPoints({
        entries: [entry("a", 100), entry("b", -100)],
        variantMetrics: metricsFor(["a", "b"]),
        variantNames: { a: "A", b: "B" },
        targetColors: undefined,
        axis: AXIS,
        dominance: { dimensions: [], dominatedBy: {}, front: [], edges: [] },
      });

      expect(points.map((p) => p.variantId)).toEqual(["a", "b"]);
    });
  });
});
