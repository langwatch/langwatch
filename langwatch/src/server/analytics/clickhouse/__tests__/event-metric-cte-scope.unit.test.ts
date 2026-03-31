/**
 * @regression
 *
 * Event-based metrics (sentiment.thumbs_up_down, events.event_type) produce
 * selectExpressions that reference `ss."Events.Name"` (the stored_spans alias).
 * When these metrics are used alongside a groupBy that triggers the CTE dedup
 * path (buildArrayJoinTimeseriesQuery), the metric expression ends up in the
 * outer SELECT — but the `ss` alias only exists inside the CTE. This caused
 * ClickHouse to reject the query with:
 *
 *   "Unknown expression or function identifier 'ss.Events.Name' in scope"
 *
 * The fix in transformMetricForDedup() detects expressions containing
 * ss."Events.Name" or ss."Events.Attributes" and rewrites them to
 * uniqExact(trace_id), since in the CTE context the group_key already
 * filters to matching events.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetParamCounter } from "../filter-translator";
import { buildTimeseriesQuery } from "../aggregation-builder";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";

/**
 * Extract the outer SELECT portion of a CTE-based query.
 * The outer SELECT is everything after the closing parenthesis of the CTE
 * definition and the final SELECT keyword.
 */
function extractOuterSelect(sql: string): string {
  // The CTE ends with `) SELECT ...` — find the outer SELECT
  const cteEndMatch = sql.match(
    /\)\s*SELECT\s+([\s\S]+?)FROM\s+deduped_traces/i,
  );
  return cteEndMatch?.[1] ?? "";
}

describe("event metric CTE scope regression", () => {
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

  describe("when sentiment.thumbs_up_down metric is used with sentiment.thumbs_up_down groupBy", () => {
    it("does not reference ss.Events.Name in the outer SELECT", () => {
      const result = buildTimeseriesQuery({
        ...baseInput,
        series: [
          {
            metric:
              "sentiment.thumbs_up_down" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
          },
        ],
        groupBy: "sentiment.thumbs_up_down",
      });

      // The query must use the CTE dedup path (WITH ... AS)
      expect(result.sql).toContain("WITH deduped_traces AS");

      // The outer SELECT must NOT reference ss."Events.Name" — that alias
      // only exists inside the CTE
      const outerSelect = extractOuterSelect(result.sql);
      expect(outerSelect).not.toContain('ss."Events.Name"');
      expect(outerSelect).not.toContain('ss."Events.Attributes"');

      // The transformed metric should use uniqExact(trace_id) instead
      expect(outerSelect).toContain("uniqExact(trace_id)");
    });

    it("still references ss.Events.Name inside the CTE where the alias is valid", () => {
      const result = buildTimeseriesQuery({
        ...baseInput,
        series: [
          {
            metric:
              "sentiment.thumbs_up_down" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
          },
        ],
        groupBy: "sentiment.thumbs_up_down",
      });

      // The CTE inner query should still use the stored_spans columns
      // (the groupBy expression uses Events.Name and Events.Attributes)
      const cteMatch = result.sql.match(
        /WITH deduped_traces AS\s*\(([\s\S]+?)\)\s*SELECT/,
      );
      const cteBody = cteMatch?.[1] ?? "";
      expect(cteBody).toContain('"Events.Name"');
    });
  });

  describe("when events.event_type metric is used with events.event_type groupBy", () => {
    it("does not reference ss.Events.Name in the outer SELECT", () => {
      const result = buildTimeseriesQuery({
        ...baseInput,
        series: [
          {
            metric: "events.event_type" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            key: "thumbs_up_down",
          },
        ],
        groupBy: "events.event_type",
      });

      // Must use CTE dedup path
      expect(result.sql).toContain("WITH deduped_traces AS");

      // Outer SELECT must not leak stored_spans alias
      const outerSelect = extractOuterSelect(result.sql);
      expect(outerSelect).not.toContain('ss."Events.Name"');
      expect(outerSelect).not.toContain('ss."Events.Attributes"');

      // Should be rewritten to uniqExact(trace_id)
      expect(outerSelect).toContain("uniqExact(trace_id)");
    });

    it("does not reference ss.Events.Name in the outer SELECT without a metric key", () => {
      const result = buildTimeseriesQuery({
        ...baseInput,
        series: [
          {
            metric: "events.event_type" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
          },
        ],
        groupBy: "events.event_type",
      });

      expect(result.sql).toContain("WITH deduped_traces AS");

      const outerSelect = extractOuterSelect(result.sql);
      expect(outerSelect).not.toContain('ss."Events.Name"');
    });
  });

  describe("when events.event_score metric is used with events.event_type groupBy", () => {
    it("does not reference ss.Events.Attributes in the outer SELECT", () => {
      const result = buildTimeseriesQuery({
        ...baseInput,
        series: [
          {
            metric: "events.event_score" as FlattenAnalyticsMetricsEnum,
            aggregation: "avg" as const,
            key: "thumbs_up_down",
          },
        ],
        groupBy: "events.event_type",
      });

      expect(result.sql).toContain("WITH deduped_traces AS");

      const outerSelect = extractOuterSelect(result.sql);
      expect(outerSelect).not.toContain('ss."Events.Name"');
      expect(outerSelect).not.toContain('ss."Events.Attributes"');
    });
  });
});
