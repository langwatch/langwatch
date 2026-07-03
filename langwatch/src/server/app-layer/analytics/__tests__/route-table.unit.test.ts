/**
 * Unit tests for `pickAnalyticsTable` — the ADR-034 Phase 3 read router.
 *
 * The router is purely defensive: anything unknown / unsupported / mixed
 * routes to `trace_summaries` (the legacy, safe path). These tests
 * exhaustively map the per-destination eligibility predicates onto concrete
 * series/filter/groupBy combinations.
 */

import { describe, expect, it } from "vitest";
import type { SeriesInputType } from "~/server/analytics/registry";
import {
  pickAnalyticsTable,
  ROLLUP_ROLLABLE_METRIC_KEYS,
  SLIM_ELIGIBLE_METRIC_KEYS,
} from "../routing/route-table";

function series(
  metric: SeriesInputType["metric"],
  aggregation: SeriesInputType["aggregation"] = "sum",
  overrides: Partial<SeriesInputType> = {},
): SeriesInputType {
  return {
    metric,
    aggregation,
    ...overrides,
  };
}

describe("pickAnalyticsTable (ADR-034 Phase 3 read router)", () => {
  describe("given an empty series array", () => {
    it("routes to trace_summaries (safe fallback)", () => {
      expect(pickAnalyticsTable({ series: [] })).toBe("trace_summaries");
    });
  });

  describe("given an additive metric on total cost", () => {
    describe("when grouped by model and the aggregation is sum", () => {
      it("routes to trace_analytics_rollup", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.total_cost", "sum")],
          groupBy: "metadata.model",
        });
        expect(table).toBe("trace_analytics_rollup");
      });
    });

    describe("when the aggregation is avg", () => {
      // Regression (trace5012-P0): avg over the rollup's SimpleAggregateFunction(sum)
      // columns is the mean of per-bucket sums, not the per-trace mean — so avg must
      // NEVER route to trace_analytics_rollup. With a slim-eligible group-by it goes
      // to slim; with a rollup-only group-by (span_type, not on slim) it falls to legacy.
      it("routes to trace_analytics (slim) when grouped by a slim-eligible dim", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.total_cost", "avg")],
          groupBy: "metadata.user_id",
        });
        expect(table).toBe("trace_analytics");
      });

      it("falls back to trace_summaries when grouped by span_type (not on slim, avg not on rollup)", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.total_cost", "avg")],
          groupBy: "metadata.span_type",
        });
        expect(table).toBe("trace_summaries");
      });

      it("routes to trace_analytics (slim) with no group-by", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.total_cost", "avg")],
        });
        expect(table).toBe("trace_analytics");
      });
    });

    describe("when grouped by topic", () => {
      it("falls through to trace_analytics (slim)", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.total_cost", "sum")],
          groupBy: "topics.topics",
        });
        expect(table).toBe("trace_analytics");
      });
    });

    describe("when no group-by is set", () => {
      it("routes to trace_analytics_rollup", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.total_cost", "sum")],
        });
        expect(table).toBe("trace_analytics_rollup");
      });
    });
  });

  describe("given a percentile aggregation", () => {
    describe("when no group-by is set", () => {
      it("routes to trace_analytics (slim) because rollup can't do percentiles", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.completion_time", "p95")],
        });
        expect(table).toBe("trace_analytics");
      });
    });

    describe("when grouped by model", () => {
      it("falls back to trace_summaries (rollup can't do percentiles; slim's per-trace Models[] would re-attribute multi-model traces wrongly vs the rollup's per-span split)", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.completion_time", "median")],
          groupBy: "metadata.model",
        });
        expect(table).toBe("trace_summaries");
      });
    });
  });

  describe("given a cardinality aggregation on metadata.trace_id", () => {
    it("routes to trace_analytics (slim is one-row-per-trace; rollup has no TraceUniq)", () => {
      const table = pickAnalyticsTable({
        series: [series("metadata.trace_id", "cardinality")],
      });
      expect(table).toBe("trace_analytics");
    });
  });

  describe("given a filter on a well-known metadata column", () => {
    describe("when filtering on metadata.user_id", () => {
      it("routes to trace_analytics (typed UserId column on slim)", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.total_cost", "sum")],
          filters: { "metadata.user_id": ["alice"] },
        });
        expect(table).toBe("trace_analytics");
      });
    });

    describe("when filtering on traces.error", () => {
      it("routes to trace_analytics (HasError column on slim)", () => {
        const table = pickAnalyticsTable({
          series: [series("performance.total_cost", "sum")],
          filters: { "traces.error": ["true"] },
        });
        expect(table).toBe("trace_analytics");
      });
    });
  });

  describe("given a metadata.key filter on an arbitrary id-shaped key", () => {
    it("routes to trace_analytics (slim Attributes carries metadata.* + reserved)", () => {
      const table = pickAnalyticsTable({
        series: [series("performance.total_cost", "sum")],
        filters: { "metadata.key": ["metadata.environment"] },
      });
      expect(table).toBe("trace_analytics");
    });
  });

  describe("given a metadata.key filter on a blocklisted payload key", () => {
    it("falls back to trace_summaries (slim trim drops payload keys)", () => {
      const table = pickAnalyticsTable({
        series: [series("performance.total_cost", "sum")],
        filters: { "metadata.key": ["gen_ai.prompt"] },
      });
      expect(table).toBe("trace_summaries");
    });
  });

  describe("given a metadata.value filter on a blocklisted prefix key", () => {
    it("falls back to trace_summaries", () => {
      const table = pickAnalyticsTable({
        series: [series("performance.total_cost", "sum")],
        filters: {
          "metadata.value": {
            "gen_ai.completion.0.content": ["assistant text"],
          },
        },
      });
      expect(table).toBe("trace_summaries");
    });
  });

  describe("given a filter the slim table does not carry", () => {
    it("falls back to trace_summaries (event filters need stored_spans)", () => {
      const table = pickAnalyticsTable({
        series: [series("performance.total_cost", "sum")],
        filters: { "events.event_type": ["thumbs_up_down"] },
      });
      expect(table).toBe("trace_summaries");
    });
  });

  describe("given an evaluation metric with a per-evaluator key", () => {
    it("falls back to evaluation_runs (rt5014-001: eval slim has no EvaluatorId column; rt5014-002: rollup would silently drop the key)", () => {
      const table = pickAnalyticsTable({
        series: [
          series("evaluations.evaluation_score", "avg", {
            key: "evaluator-x",
          }),
        ],
      });
      expect(table).toBe("evaluation_runs");
    });
  });

  describe("given an evaluation metric with NO key (aggregate over all evaluators)", () => {
    it("routes to evaluation_analytics_rollup (ADR-034 Phase 6 — eval fast-path)", () => {
      const table = pickAnalyticsTable({
        series: [series("evaluations.evaluation_runs", "cardinality")],
      });
      expect(table).toBe("evaluation_analytics_rollup");
    });
  });

  describe("given a series with key/subkey", () => {
    it("falls back to trace_summaries (key/subkey metrics need the legacy translator)", () => {
      const table = pickAnalyticsTable({
        series: [
          series("performance.total_cost", "sum", { key: "anything" }),
        ],
      });
      expect(table).toBe("trace_summaries");
    });
  });

  describe("given a series-level filter", () => {
    it("falls back to trace_summaries (per-series filters complicate routing)", () => {
      const table = pickAnalyticsTable({
        series: [
          series("performance.total_cost", "sum", {
            filters: { "metadata.user_id": ["alice"] },
          }),
        ],
      });
      expect(table).toBe("trace_summaries");
    });
  });

  describe("given a pipeline aggregation (per-user)", () => {
    // Regression (trace5012-P0): the slim builder does not implement the outer
    // pipeline re-aggregation, so a pipeline series must route to the legacy
    // fallback — never rollup (no per-user key) and never slim (would silently
    // return the flat inner aggregation).
    it("routes to trace_summaries (legacy), not rollup and not slim", () => {
      const table = pickAnalyticsTable({
        series: [
          series("performance.total_cost", "sum", {
            pipeline: { field: "user_id", aggregation: "avg" },
          }),
        ],
      });
      expect(table).toBe("trace_summaries");
    });
  });

  describe("given a mixed query: one rollup-eligible series and one slim-only series", () => {
    it("falls back to trace_summaries (rollup requires every series to be additive + rollable; slim covers more metrics)", () => {
      const table = pickAnalyticsTable({
        series: [
          series("performance.total_cost", "sum"),
          series("performance.completion_time", "p95"),
        ],
      });
      // Both series eligible on slim (total_cost has a slim col; completion
      // time has TotalDurationMs + percentile via quantileExact), so the
      // router picks slim.
      expect(table).toBe("trace_analytics");
    });
  });

  describe("given an unknown metric not in either registry set", () => {
    it("falls back to trace_summaries", () => {
      // sentiment.thumbs_up_down isn't in SLIM_ELIGIBLE_METRIC_KEYS, so it
      // routes to trace_summaries.
      const table = pickAnalyticsTable({
        // biome-ignore lint: forging an unknown shape for the fallback test
        series: [series("sentiment.thumbs_up_down" as any, "cardinality")],
      });
      expect(table).toBe("trace_summaries");
    });
  });

  describe("rollup metric set sanity", () => {
    it("only lists additive, per-span metrics that the rollup carries", () => {
      // Phase 1 rollup columns: CostSum, NonBilledCostSum, DurationSum (root),
      // PromptTokensSum, CompletionTokensSum, Cache{Read,Write}TokensSum,
      // ReasoningTokensSum, SpanCount, ErrorCount.
      // total_tokens and total_processed_tokens compose from the above sums.
      const expected = [
        "performance.total_cost",
        "performance.cost_billed",
        "performance.cost_non_billed",
        "performance.completion_time",
        "performance.prompt_tokens",
        "performance.completion_tokens",
        "performance.cache_read_tokens",
        "performance.cache_write_tokens",
        "performance.reasoning_tokens",
        "performance.total_tokens",
        "performance.total_processed_tokens",
      ];
      for (const m of expected) {
        expect(ROLLUP_ROLLABLE_METRIC_KEYS.has(m)).toBe(true);
      }
    });

    it("does not list percentile-only or distinct-only metrics", () => {
      // TimeToFirstToken / TokensPerSecond aren't on the rollup; cardinality
      // of trace_id isn't either (uniq state not held on Simple… columns).
      expect(ROLLUP_ROLLABLE_METRIC_KEYS.has("performance.first_token")).toBe(false);
      expect(ROLLUP_ROLLABLE_METRIC_KEYS.has("performance.tokens_per_second")).toBe(false);
      expect(ROLLUP_ROLLABLE_METRIC_KEYS.has("metadata.trace_id")).toBe(false);
    });
  });

  describe("slim metric set sanity", () => {
    it("covers everything the rollup covers plus the slim-only metrics", () => {
      for (const m of ROLLUP_ROLLABLE_METRIC_KEYS) {
        expect(SLIM_ELIGIBLE_METRIC_KEYS.has(m)).toBe(true);
      }
      // first_token + tokens_per_second + trace_id distinct only live on slim.
      expect(SLIM_ELIGIBLE_METRIC_KEYS.has("performance.first_token")).toBe(true);
      expect(SLIM_ELIGIBLE_METRIC_KEYS.has("performance.tokens_per_second")).toBe(true);
      expect(SLIM_ELIGIBLE_METRIC_KEYS.has("metadata.trace_id")).toBe(true);
    });
  });
});
