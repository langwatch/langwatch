/**
 * Phase 6 routing tests — eval-source metrics route to the eval analytics
 * tables, never to a trace table; legacy fallback is `evaluation_runs`,
 * never `trace_summaries` for eval-source queries.
 */

import { describe, expect, it } from "vitest";
import type { SeriesInputType } from "~/server/analytics/registry";
import { getMetricSource } from "../routing/field-availability";
import { pickAnalyticsTable } from "../routing/route-table";

function series(
  metric: string,
  agg: SeriesInputType["aggregation"],
): SeriesInputType {
  return { metric, aggregation: agg } as SeriesInputType;
}

describe("pickAnalyticsTable — eval-source routing (Phase 6)", () => {
  describe("when the series is an eval metric the rollup can serve", () => {
    it("routes a sum / additive query to evaluation_analytics_rollup", () => {
      expect(
        pickAnalyticsTable({
          series: [series("evaluations.evaluation_runs", "cardinality")],
        }),
      ).toBe("evaluation_analytics_rollup");
    });

    it("routes an avg / score query with no group-by to evaluation_analytics_rollup", () => {
      expect(
        pickAnalyticsTable({
          series: [series("evaluations.evaluation_score", "avg")],
        }),
      ).toBe("evaluation_analytics_rollup");
    });

    it("routes a group-by-evaluator-type query to evaluation_analytics_rollup", () => {
      expect(
        pickAnalyticsTable({
          series: [series("evaluations.evaluation_score", "avg")],
          groupBy: "evaluations.evaluator_type",
        }),
      ).toBe("evaluation_analytics_rollup");
    });
  });

  describe("when the series is an eval metric the rollup cannot serve", () => {
    it("routes a percentile query (median) to evaluation_analytics (slim)", () => {
      expect(
        pickAnalyticsTable({
          series: [series("evaluations.evaluation_score", "median")],
        }),
      ).toBe("evaluation_analytics");
    });

    // Regression (eval5014-P1): min/max on the eval rollup compute
    // min/max(ScoreSum / ScoreCount) per ROW — the min/max of per-bucket
    // AVERAGES, which is merge-state dependent and not the true worst/best
    // score. They must route to the slim per-eval table instead.
    it("routes a min / score query to evaluation_analytics (slim), not rollup", () => {
      expect(
        pickAnalyticsTable({
          series: [series("evaluations.evaluation_score", "min")],
        }),
      ).toBe("evaluation_analytics");
    });

    it("routes a max / score query to evaluation_analytics (slim), not rollup", () => {
      expect(
        pickAnalyticsTable({
          series: [series("evaluations.evaluation_score", "max")],
        }),
      ).toBe("evaluation_analytics");
    });
  });

  describe("when the series is an eval metric but the filter is unsupported", () => {
    it("falls back to evaluation_runs, not trace_summaries", () => {
      const table = pickAnalyticsTable({
        series: [series("evaluations.evaluation_score", "avg")],
        filters: {
          "traces.origin": ["production"], // not in the eval slim/rollup filter set
        },
      });
      expect(table).toBe("evaluation_runs");
    });
  });

  describe("when the series mixes a trace metric and an eval metric", () => {
    it("falls back to trace_summaries (the only legacy path that can mix)", () => {
      const table = pickAnalyticsTable({
        series: [
          series("performance.total_cost", "sum"),
          series("evaluations.evaluation_runs", "cardinality"),
        ],
      });
      expect(table).toBe("trace_summaries");
    });
  });
});

describe("getMetricSource — eval-domain coverage", () => {
  it("returns 'evaluation' for the three core eval metrics", () => {
    expect(getMetricSource("evaluations.evaluation_score")).toBe("evaluation");
    expect(getMetricSource("evaluations.evaluation_pass_rate")).toBe(
      "evaluation",
    );
    expect(getMetricSource("evaluations.evaluation_runs")).toBe("evaluation");
  });

  it("returns 'trace' for trace-domain metrics", () => {
    expect(getMetricSource("performance.total_cost")).toBe("trace");
    expect(getMetricSource("metadata.user_id")).toBe("trace");
  });

  it("returns undefined for unknown metrics (legacy-only)", () => {
    expect(getMetricSource("sentiment.thumbs_up_down")).toBeUndefined();
  });
});
