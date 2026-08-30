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
import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import {
  __testOnly__,
  buildTimeseriesQuery,
  TRACE_ATTRIBUTE_METRIC_COLUMNS,
} from "../aggregation-builder";
import { fieldMappings } from "../field-mappings";
import { resetParamCounter } from "../filter-translator";

/**
 * The metrics whose translation actually emits a trace-level `Attributes` read
 * — i.e. the ones that can reach the outer aggregation this suite is about.
 * `metric-translator.ts` has a case for each (`translateMetadataMetric`).
 *
 * Deliberately NOT here, despite mapping to `Attributes` in `fieldMappings`:
 * `metadata.customer_id` has no translator case, so it falls through to
 * `count()` and would exercise an early return rather than an attribute read;
 * `metadata.labels` and `metadata.prompt_ids` are group-by / filter fields
 * rather than metrics (`metadata.labels` is in fact the group-by that puts
 * these queries on the CTE path). All three are still covered by the hoist
 * table, and the field-mapping invariant at the bottom is what keeps that
 * honest.
 */
const ATTRIBUTE_METRICS = ["metadata.thread_id", "metadata.user_id"] as const;

const baseInput = {
  projectId: "test-project",
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-01-02T00:00:00Z"),
  previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
  timeScale: 60,
};

/**
 * Everything after the CTE closes — the scope where `ts` does not exist.
 *
 * Anchored on `FROM deduped_traces` (as the sibling event-metric suite is) so
 * a failed match cannot fail OPEN: an unanchored regex that missed would
 * return `""`, and `expect("").not.toContain("ts.")` passes, which is a
 * leak-detector that reports success when it cannot see.
 */
function outerQuery(sql: string): string {
  const match = sql.match(/\)\s*SELECT\s+([\s\S]+?)FROM\s+deduped_traces/i);
  if (!match?.[1]) {
    throw new Error(
      "could not extract the outer SELECT — the assertion would have passed vacuously",
    );
  }
  return match[1];
}

function buildGroupedByLabels(metric: string) {
  return buildTimeseriesQuery({
    ...baseInput,
    series: [
      {
        metric: metric as AnalyticsSeries["metric"],
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
      // `user_id` is the meaningful assertion — it is an attribute that CAN be
      // hoisted, so it catches an over-broad hoist that the never-hoistable
      // columns would not.
      it("hoists only the attribute the requested metric reads", () => {
        const { sql } = buildGroupedByLabels("metadata.thread_id");

        expect(sql).toContain("AS trace_attr_thread_id");
        expect(sql).not.toContain("AS trace_attr_user_id");
        expect(sql).not.toContain("AS trace_attr_customer_id");
      });
    });
  });

  // The guard relocation is the other half of the fix, and it needs its own
  // test: every expression the SQL-shape cases above exercise now DOES rewrite,
  // so the guard fires from either position and moving it back inside
  // `if (rewritten !== selectExpression)` leaves them all green. The case that
  // distinguishes the two positions — and the one that reached production — is
  // the expression that matches NO substitution at all.
  describe("given a metric expression no substitution matches", () => {
    describe("when it is transformed for the dedup CTE", () => {
      it("refuses it instead of emitting a ts reference the outer query cannot resolve", () => {
        expect(() =>
          __testOnly__.transformMetricForDedup(
            "uniqIf(ts.SomeUnmappedColumn, ts.SomeUnmappedColumn != '') AS m",
            "m",
          ),
        ).toThrow(/could not fully rewrite/);
      });

      // The partial-rewrite case the guard already covered from its old
      // position, kept so a future refactor cannot trade one for the other.
      it("refuses an expression only some of which rewrites", () => {
        expect(() =>
          __testOnly__.transformMetricForDedup(
            "sum(ts.TotalCost + ts.SomeUnmappedColumn) AS m",
            "m",
          ),
        ).toThrow(/could not fully rewrite/);
      });
    });
  });

  // The defect this suite exists for was not a wrong expression — it was a
  // mapping nobody added to the hoist table. Enumerating the registry rather
  // than a hand-written list is what stops the next `Attributes`-backed field
  // reintroducing it: add a mapping without a hoist and this fails, instead of
  // ClickHouse rejecting the query in production.
  describe("given the trace-level Attributes field mappings", () => {
    describe("when the hoist table is compared against them", () => {
      it("covers every Attributes-backed trace_summaries mapping", () => {
        const mapped = Object.values(fieldMappings)
          .filter(
            (mapping) =>
              mapping.table === "trace_summaries" &&
              // `includes`, not `startsWith`: every mapping is a bare map read
              // today, but one written as `toFloat64(Attributes['x'])` would
              // slip past a prefix test and the invariant would still read
              // green — reintroducing the very "someone must remember" gap
              // this test exists to close. `SpanAttributes[` is excluded by
              // the `trace_summaries` table check above.
              mapping.column.includes("Attributes["),
          )
          .map((mapping) => {
            const key = mapping.column.match(/Attributes\['([^']+)'\]/);
            return key?.[1] ?? mapping.column;
          });

        const hoisted = TRACE_ATTRIBUTE_METRIC_COLUMNS.map(({ attributeKey }) => attributeKey);

        expect(mapped.length).toBeGreaterThan(0);
        expect([...new Set(mapped)].sort()).toEqual([...new Set(hoisted)].sort());
      });
    });
  });
});
