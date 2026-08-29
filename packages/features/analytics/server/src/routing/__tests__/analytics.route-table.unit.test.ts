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
});
