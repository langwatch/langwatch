/**
 * Where the dashboard and the span type picker read a span's type: span_analytics' plain
 * `SpanType` where its floor covers the window, the stored_spans map elsewhere.
 * @see specs/analytics/span-type-light-reads.feature
 */

import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { clickHouseFilters } from "../clickhouse.filter-definitions.mapper.ts";
import { spanTypeOptionsParams } from "../clickhouse.filter-query-helpers.mapper.ts";
import { resetParamCounter, translateAllFilters } from "../clickhouse.filter-translator.mapper.ts";

const FLOOR_ISO = "2026-10-01T00:00:00.000Z";
const FLOOR_MS = Date.parse(FLOOR_ISO);
const FLOOR = { from: FLOOR_ISO, rebuilding: false };
const MAP_READ = "SpanAttributes['langwatch.span.type']";

/** A window whose span bound (previous start less two days) opens `offsetDays` after the floor. */
function windowAfterFloor(offsetDays: number) {
  const previousStart = new Date(FLOOR_MS + offsetDays * 86_400_000);
  return {
    projectId: "p1",
    previousPeriodStartDate: previousStart,
    startDate: new Date(previousStart.getTime() + 7 * 86_400_000),
    endDate: new Date(previousStart.getTime() + 14 * 86_400_000),
    timeScale: 60,
  };
}

const traceCount: AnalyticsSeries[] = [{ metric: "metadata.trace_id", aggregation: "cardinality" }];

describe("given a dashboard filtered by span type", () => {
  beforeEach(() => resetParamCounter());

  describe("when the floor covers the span window", () => {
    /** @scenario "The dashboard span type filter reads span_analytics where the floor covers it" */
    it("reads span_analytics' SpanType and never the map", () => {
      const built = buildTimeseriesQuery({
        ...windowAfterFloor(3),
        series: traceCount,
        filters: { "spans.type": ["llm"] },
        spanAnalyticsFloor: FLOOR,
      });

      expect(built.sql).toContain("FROM span_analytics");
      expect(built.sql).toContain("SpanType IN (");
      expect(built.sql).not.toContain(MAP_READ);
    });
  });

  describe("when the span window opens before the floor", () => {
    /** @scenario "The dashboard span type filter reads span_analytics where the floor covers it" */
    it("reads span_analytics from the floor on and the map only before it", () => {
      const translation = translateAllFilters(
        { "spans.type": ["llm"] },
        { spanAnalytics: { kind: "split", fromMs: FLOOR_MS } },
      );

      expect(translation.whereClause).toMatch(
        /FROM span_analytics[\s\S]*StartTime >= fromUnixTimestamp64Milli\(\{spanAnalyticsFrom_\d+:Int64\}\)[\s\S]*UNION ALL[\s\S]*FROM stored_spans[\s\S]*StartTime < fromUnixTimestamp64Milli/,
      );
      expect(Object.values(translation.params)).toContain(FLOOR_MS);
    });

    /** @scenario "The dashboard span type filter reads span_analytics where the floor covers it" */
    it("negates the split subquery as one NOT IN", () => {
      const translation = translateAllFilters(
        { "spans.type": ["llm"] },
        { spanAnalytics: { kind: "split", fromMs: FLOOR_MS } },
      );

      expect(translation.negatedWhereClause).toMatch(/^\(ts\.TenantId, ts\.TraceId\) NOT IN \(/);
    });
  });

  describe("when there is no usable floor", () => {
    /** @scenario "A rebuilding, unknown or unparseable floor keeps stored_spans" */
    it("keeps the stored_spans map read", () => {
      for (const floor of [null, { from: FLOOR_ISO, rebuilding: true }]) {
        const built = buildTimeseriesQuery({
          ...windowAfterFloor(3),
          series: traceCount,
          filters: { "spans.type": ["llm"] },
          spanAnalyticsFloor: floor,
        });

        expect(built.sql).toContain(MAP_READ);
        expect(built.sql).not.toContain("span_analytics");
      }
    });
  });
});

describe("given a dashboard grouped by span type", () => {
  beforeEach(() => resetParamCounter());

  describe("when the floor covers the span window", () => {
    /** @scenario "Grouping a dashboard by span type joins span_analytics" */
    it("joins span_analytics with SpanType under the joined map's name", () => {
      const built = buildTimeseriesQuery({
        ...windowAfterFloor(3),
        series: traceCount,
        groupBy: "metadata.span_type",
        spanAnalyticsFloor: FLOOR,
      });

      expect(built.sql).toContain(
        "map('langwatch.span.type', toString(SpanType)) AS JoinedSpanAttributes FROM span_analytics",
      );
      expect(built.sql).not.toContain("FROM stored_spans");
    });
  });

  describe("when the span window opens before the floor", () => {
    /** @scenario "Grouping a dashboard by span type joins span_analytics" */
    it("joins span_analytics from the floor on and stored_spans before it, binding the floor", () => {
      const built = buildTimeseriesQuery({
        ...windowAfterFloor(-5),
        series: traceCount,
        groupBy: "metadata.span_type",
        spanAnalyticsFloor: FLOOR,
      });

      expect(built.sql).toMatch(
        /FROM span_analytics WHERE [\s\S]*?StartTime >= fromUnixTimestamp64Milli\(\{spanAnalyticsJoinFrom:Int64\}\) UNION ALL SELECT [\s\S]*?FROM stored_spans WHERE [\s\S]*?StartTime < fromUnixTimestamp64Milli\(\{spanAnalyticsJoinFrom:Int64\}\)\) ss ON/,
      );
      expect(built.params.spanAnalyticsJoinFrom).toBe(FLOOR_MS);
    });
  });

  describe("when the span join also reads another span attribute", () => {
    /** @scenario "Grouping a dashboard by span type joins span_analytics" */
    it("keeps the join on stored_spans", () => {
      const built = buildTimeseriesQuery({
        ...windowAfterFloor(3),
        series: [{ metric: "spans.model", aggregation: "cardinality" }],
        groupBy: "metadata.span_type",
        spanAnalyticsFloor: FLOOR,
      });

      expect(built.sql).toContain("FROM stored_spans");
      expect(built.sql).not.toContain("span_analytics");
    });
  });
});

describe("given the span type picker", () => {
  const picker = clickHouseFilters["spans.type"]!;
  const params = { startDate: FLOOR_MS + 86_400_000, endDate: FLOOR_MS + 8 * 86_400_000 };

  describe("when the floor covers the picker's window", () => {
    /** @scenario "The span type picker reads span_analytics where the floor covers it" */
    it("counts span_analytics' SpanType and binds no floor", () => {
      const query = { ...params, spanAnalyticsFloor: FLOOR };
      const sql = picker.buildQuery(query)!;

      expect(sql).toContain("FROM span_analytics");
      expect(sql).toContain("SpanType != ''");
      expect(sql).not.toContain(MAP_READ);
      expect(spanTypeOptionsParams(query)).toEqual({});
    });
  });

  describe("when the window opens before the floor", () => {
    /** @scenario "The span type picker reads span_analytics where the floor covers it" */
    it("counts both tables split at the floor it binds", () => {
      const query = { ...params, startDate: FLOOR_MS - 86_400_000, spanAnalyticsFloor: FLOOR };
      const sql = picker.buildQuery(query)!;

      expect(sql).toMatch(
        /FROM span_analytics[\s\S]*StartTime >= fromUnixTimestamp64Milli\(\{spanAnalyticsFrom:UInt64\}\)[\s\S]*UNION ALL[\s\S]*FROM stored_spans[\s\S]*StartTime < fromUnixTimestamp64Milli\(\{spanAnalyticsFrom:UInt64\}\)/,
      );
      expect(spanTypeOptionsParams(query)).toEqual({ spanAnalyticsFrom: FLOOR_MS });
    });
  });

  describe("when there is no floor", () => {
    /** @scenario "A rebuilding, unknown or unparseable floor keeps stored_spans" */
    it("counts the stored_spans map as before", () => {
      const sql = picker.buildQuery(params)!;

      expect(sql).toContain(MAP_READ);
      expect(sql).not.toContain("span_analytics");
    });
  });
});
