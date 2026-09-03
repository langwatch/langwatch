import { describe, expect, it } from "vitest";
import { pickAnalyticsTable } from "../route-table";

describe("Analytics timeseries route table", () => {
  it("uses the evaluation rollup for safe evaluation sums", () => {
    expect(
      pickAnalyticsTable({
        series: [{ metric: "evaluations.evaluation_runs", aggregation: "cardinality" }],
      }),
    ).toBe("evaluation_analytics_rollup");
  });

  it("uses slim for supported trace dimensions", () => {
    expect(
      pickAnalyticsTable({
        series: [{ metric: "performance.total_cost", aggregation: "avg" }],
        groupBy: "metadata.user_id",
      }),
    ).toBe("trace_analytics");
  });

  it("does not route trimmed payload attributes to slim", () => {
    expect(
      pickAnalyticsTable({
        series: [{ metric: "performance.total_cost", aggregation: "sum" }],
        filters: { "metadata.key": ["gen_ai.prompt.0.content"] },
      }),
    ).toBe("trace_summaries");
  });

  describe("given a query carrying negateFilters", () => {
    // The fast-path builders do not implement filter negation — serving the
    // query from slim/rollup would silently return NON-negated results.
    /** @scenario Negated filters stay accurate on optimized analytics storage */
    it("routes a trace-source query to trace_summaries", () => {
      expect(
        pickAnalyticsTable({
          series: [{ metric: "performance.total_cost", aggregation: "sum" }],
          negateFilters: true,
        }),
      ).toBe("trace_summaries");
    });

    it("routes an eval-source query to evaluation_runs", () => {
      expect(
        pickAnalyticsTable({
          series: [{ metric: "evaluations.evaluation_runs", aggregation: "cardinality" }],
          negateFilters: true,
        }),
      ).toBe("evaluation_runs");
    });

    it("still routes to the rollup when negateFilters is false", () => {
      expect(
        pickAnalyticsTable({
          series: [{ metric: "performance.total_cost", aggregation: "sum" }],
          negateFilters: false,
        }),
      ).toBe("trace_analytics_rollup");
    });
  });

  describe("given a query scoped to explicit trace ids", () => {
    // The fast-path builders do not implement the TraceId narrowing — the
    // result would silently cover ALL traces instead of the requested set.
    /** @scenario Trace-scoped graphs stay accurate on optimized analytics storage */
    it("routes a trace-source query to trace_summaries", () => {
      expect(
        pickAnalyticsTable({
          series: [{ metric: "performance.total_cost", aggregation: "sum" }],
          traceIds: ["trace-1", "trace-2"],
        }),
      ).toBe("trace_summaries");
    });

    it("routes an eval-source query to evaluation_runs", () => {
      expect(
        pickAnalyticsTable({
          series: [{ metric: "evaluations.evaluation_runs", aggregation: "cardinality" }],
          traceIds: ["trace-1"],
        }),
      ).toBe("evaluation_runs");
    });
  });
});
