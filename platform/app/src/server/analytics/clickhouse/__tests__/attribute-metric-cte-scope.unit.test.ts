/**
 * @regression
 *
 * Metrics backed by the trace-level `Attributes` map — metadata.thread_id,
 * user_id, customer_id, labels, prompt_ids — are aggregated in the OUTER query
 * of the arrayJoin CTE path, which reads `FROM deduped_traces` and has no `ts`
 * alias in scope. Only three hardcoded `langwatch.reserved.*` token keys were
 * hoisted into the CTE, so every other Attributes-backed metric emitted a raw
 * `ts.Attributes[…]` into that outer SELECT and ClickHouse rejected the whole
 * query:
 *
 *   "Unknown expression or function identifier `ts.Attributes` in scope
 *    WITH deduped_traces AS (SELECT DISTINCT ts.TraceId AS trace_id, …"
 *
 * Observed in production 2026-08-10: a thread-id count grouped by label.
 *
 * `transformMetricForDedup` already had a guard for exactly this — it throws
 * when a rewritten expression still references `ts` — but the guard only ran
 * when a substitution had ALREADY matched. The expression that reaches
 * production unrewritten is precisely the one that matches nothing, so the
 * guard's own precondition excluded the failing case.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import { buildTimeseriesQuery } from "../aggregation-builder";
import { resetParamCounter } from "../filter-translator";

const ATTRIBUTE_METRICS = [
  "metadata.thread_id",
  "metadata.user_id",
  "metadata.customer_id",
] as const;

const baseInput = {
  projectId: "test-project",
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-01-02T00:00:00Z"),
  previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
  timeScale: 60,
};

/** Everything after the CTE closes — the scope where `ts` does not exist. */
function outerQuery(sql: string): string {
  const match = sql.match(/\)\s*SELECT([\s\S]+)$/);
  return match?.[1] ?? "";
}

function buildGroupedByLabels(metric: string) {
  return buildTimeseriesQuery({
    ...baseInput,
    series: [
      {
        metric: metric as FlattenAnalyticsMetricsEnum,
        aggregation: "cardinality" as const,
      },
    ],
    // An arrayJoin group-by is what routes the query through the
    // `deduped_traces` CTE in the first place.
    groupBy: "metadata.labels",
  } as never);
}

describe("buildTimeseriesQuery()", () => {
  beforeEach(() => {
    resetParamCounter();
  });

  describe("given an Attributes-backed metric under an arrayJoin group-by", () => {
    describe("when the query is built", () => {
      for (const metric of ATTRIBUTE_METRICS) {
        it(`keeps ${metric} out of the outer scope it cannot resolve in`, () => {
          const { sql } = buildGroupedByLabels(metric);

          expect(sql).toContain("WITH deduped_traces AS");
          // The precise production failure: a `ts.` reference surviving into
          // the outer SELECT, where the only source is `deduped_traces`.
          expect(outerQuery(sql)).not.toContain("ts.");
        });
      }

      it("hoists the attribute into the CTE so the outer aggregation has a column", () => {
        const { sql } = buildGroupedByLabels("metadata.thread_id");

        expect(sql).toContain("AS trace_attr_thread_id");
        expect(outerQuery(sql)).toContain("trace_attr_thread_id");
      });

      // The hoist is conditional: pushing every attribute read would widen the
      // dedup subquery with the wide Attributes map for every grouped query.
      it("hoists only the attribute the requested metric reads", () => {
        const { sql } = buildGroupedByLabels("metadata.thread_id");

        expect(sql).not.toContain("AS trace_attr_customer_id");
        expect(sql).not.toContain("AS trace_attr_prompt_ids");
      });
    });
  });
});
