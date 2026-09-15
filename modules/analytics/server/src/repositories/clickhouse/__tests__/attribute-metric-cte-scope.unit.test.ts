/**
 * @regression Attributes-backed metrics (thread_id, user_id, etc.) emit `ts.Attributes[...]`
 * into the outer arrayJoin-CTE query, which has no `ts` in scope -- only 3 metrics were hoisted.
 * `transformMetricForDedup`'s guard only fired after a match, so the never-matching case slipped.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import {
  __testOnly__,
  buildTimeseriesQuery,
  TRACE_ATTRIBUTE_METRIC_COLUMNS,
} from "../clickhouse.aggregation-builder.mapper.ts";
import { fieldMappings } from "../clickhouse.field-mappings.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";

/**
 * Metrics whose translation actually emits a trace-level `Attributes` read (each has a
 * `translateMetadataMetric` case) -- excludes `customer_id` (no case, falls to `count()`) and
 * `labels`/`prompt_ids` (group-by/filter fields). All three are still covered by the hoist table.
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
 * Everything after the CTE closes, where `ts` does not exist. Anchored on `FROM
 * deduped_traces` (as the sibling event-metric suite is) so a failed match cannot fail OPEN --
 * an unanchored regex returning `""` would let `expect("").not.toContain("ts.")` pass vacuously.
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

  // The guard relocation is the fix's other half: every SQL-shape case above now rewrites, so
  // the guard fires from either position, and moving it back inside the old condition leaves
  // them green. The distinguishing case -- the one that reached production -- matches nothing.
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
              // `includes`, not `startsWith`: a mapping written as `toFloat64(Attributes['x'])`
              // would slip past a prefix test and this invariant would read green regardless.
              // `SpanAttributes[` is excluded by the `trace_summaries` check above.
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
