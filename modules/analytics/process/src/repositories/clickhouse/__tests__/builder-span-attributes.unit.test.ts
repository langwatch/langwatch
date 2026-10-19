/**
 * Memory-safety invariant: `SpanAttributes` is a Map column, so selecting it
 * whole materialises every key of every row (this OOMed in production) — the
 * builder may only touch it through key access.
 * @see specs/analytics/clickhouse-memory-safety.feature (Layer 1: @unit scenarios)
 */

import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";

describe("memory-safety", () => {
  beforeEach(() => {
    resetParamCounter();
  });

  const baseInput = {
    projectId: "test-project",
    startDate: new Date("2024-01-01T00:00:00Z"),
    endDate: new Date("2024-01-02T00:00:00Z"),
    previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
    timeScale: 60,
  };

  describe("when analytics queries access SpanAttributes", () => {
    /**
     * Regex matching bare "SpanAttributes" not followed by `['key']` access
     * — i.e. the full Map column being read, which can be gigabytes wide.
     */
    const bareSpanAttributesPattern = /SpanAttributes(?!\s*\[)/;

    /**
     * Extract the outermost SELECT clause from SQL. The outermost SELECT is
     * everything from the first SELECT to the first FROM that is not inside
     * a parenthesized subquery.
     */
    function getOutermostSelect(sql: string): string {
      // Find the first SELECT
      const selectIdx = sql.indexOf("SELECT");
      if (selectIdx === -1) return sql;

      // Walk forward, tracking paren depth, until we find FROM at depth 0
      let depth = 0;
      let i = selectIdx + 6; // skip "SELECT"
      while (i < sql.length) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") depth--;
        else if (depth === 0 && sql.slice(i, i + 4) === "FROM") {
          return sql.slice(selectIdx, i);
        }
        i++;
      }
      return sql.slice(selectIdx);
    }

    const metricsRequiringSpans: {
      metric: AnalyticsSeries["metric"];
      aggregation: "avg" | "sum" | "cardinality";
      label: string;
    }[] = [
      {
        metric: "performance.tokens_per_second" as AnalyticsSeries["metric"],
        aggregation: "avg",
        label: "tokens_per_second (accesses SpanAttributes for output_tokens)",
      },
      {
        metric: "events.event_type" as AnalyticsSeries["metric"],
        aggregation: "sum",
        label: "event_type (joins stored_spans for Events)",
      },
      // metadata.span_type with cardinality no longer joins stored_spans
      // (fix: span_type cardinality uses uniq(TraceId) from trace_summaries only).
      // Non-cardinality aggregations still join — covered by the groupBy test below.
    ];

    for (const { metric, aggregation, label } of metricsRequiringSpans) {
      describe(`when generating SQL for ${label}`, () => {
        /** @scenario Analytics queries access SpanAttributes only via key extraction */
        it("does not include bare SpanAttributes in the outermost SELECT", () => {
          const result = buildTimeseriesQuery({
            ...baseInput,
            series: [{ metric, aggregation }],
          });

          const outerSelect = getOutermostSelect(result.sql);
          expect(outerSelect).not.toMatch(bareSpanAttributesPattern);
        });
      });
    }

    describe("when generating SQL for any groupBy that touches stored_spans", () => {
      /** @scenario "Analytics queries access SpanAttributes only via key extraction" */
      it("does not include bare SpanAttributes in the outermost SELECT", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as AnalyticsSeries["metric"],
              aggregation: "cardinality",
            },
          ],
          groupBy: "metadata.span_type",
        });

        const outerSelect = getOutermostSelect(result.sql);
        expect(outerSelect).not.toMatch(bareSpanAttributesPattern);
      });
    });
  });
});
