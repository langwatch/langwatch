/**
 * Unit tests for the slim + rollup SQL builders (ADR-034 Phase 3,
 * app-layer module).
 *
 * Asserts the SQL shape per destination — table name in FROM, presence of
 * tenant + partition-key predicates, absence of `*Merge` (the rollup uses
 * SimpleAggregateFunction(sum, …) so `sum(col)` is the right read).
 *
 * The legacy code path (`trace_summaries`) is no longer dispatched from
 * inside the legacy `buildTimeseriesQuery`; that's owned by the new
 * AnalyticsService + the legacy shim. These tests therefore call the new
 * builders directly.
 */

import { describe, expect, it } from "vitest";
import { TRACE_ANALYTICS_HAS_SIGNAL_SQL } from "../trace-signal";
import { buildRollupTimeseriesQuery } from "../rollup-timeseries-query";
import { buildSlimTimeseriesQuery } from "../slim-timeseries-query";

const baseDates = {
  startDate: new Date("2026-06-15T00:00:00.000Z"),
  endDate: new Date("2026-06-16T00:00:00.000Z"),
  previousPeriodStartDate: new Date("2026-06-14T00:00:00.000Z"),
};

describe("buildRollupTimeseriesQuery", () => {
  const { sql, params } = buildRollupTimeseriesQuery({
    projectId: "tenant-rollup",
    ...baseDates,
    series: [{ metric: "performance.total_cost", aggregation: "sum" }],
    timeScale: 60,
  });

  it("emits FROM trace_analytics_rollup", () => {
    expect(sql).toContain("FROM trace_analytics_rollup");
  });

  it("filters on TenantId first", () => {
    expect(sql).toMatch(/WHERE\s+ra\.TenantId\s*=\s*\{tenantId:String\}/);
  });

  it("filters on the partition column BucketStart for partition pruning", () => {
    expect(sql).toContain("BucketStart >= {currentStart:DateTime64(3)}");
    expect(sql).toContain("BucketStart >= {previousStart:DateTime64(3)}");
  });

  it("uses sum(CostSum) without any *Merge combinator", () => {
    expect(sql).toContain("sum(ra.CostSum)");
    expect(sql).not.toMatch(/sumMerge|avgMerge|countMerge|quantileMerge/);
  });

  it("groups by period + date only — the rollup is an ungrouped fast-path", () => {
    expect(sql).toMatch(/GROUP BY\s+period,\s*date\s*$/m);
    expect(sql).not.toContain("group_key");
  });

  it("passes tenantId via the params object", () => {
    expect(params.tenantId).toBe("tenant-rollup");
  });

  describe("when the series is an ungrouped avg on completion_time", () => {
    it("divides the duration sum by the TraceCount denominator", () => {
      const { sql: avgSql } = buildRollupTimeseriesQuery({
        projectId: "tenant-rollup",
        ...baseDates,
        series: [{ metric: "performance.completion_time", aggregation: "avg" }],
        timeScale: 60,
      });
      expect(avgSql).toContain(
        "sum(ra.DurationSum) / nullIf(sum(ra.TraceCount), 0)",
      );
    });
  });

  describe("when a shape the router excludes reaches the builder", () => {
    it("throws on avg of a nullable metric instead of returning wrong numbers", () => {
      expect(() =>
        buildRollupTimeseriesQuery({
          projectId: "tenant-rollup",
          ...baseDates,
          series: [{ metric: "performance.total_cost", aggregation: "avg" }],
          timeScale: 60,
        }),
      ).toThrow(/avg\(performance\.total_cost\)/);
    });

    it("throws on any group-by — per-span attribution and root-only Duration/TraceCount diverge from legacy", () => {
      for (const groupBy of [
        "metadata.model",
        "metadata.span_type",
        "topics.topics",
      ]) {
        expect(() =>
          buildRollupTimeseriesQuery({
            projectId: "tenant-rollup",
            ...baseDates,
            series: [
              { metric: "performance.completion_time", aggregation: "avg" },
            ],
            groupBy,
            timeScale: 60,
          }),
        ).toThrow(/cannot group by/);
      }
    });

    it("throws on min/max — min/max of per-part sums is merge-state-dependent", () => {
      for (const aggregation of ["min", "max"] as const) {
        expect(() =>
          buildRollupTimeseriesQuery({
            projectId: "tenant-rollup",
            ...baseDates,
            series: [{ metric: "performance.total_cost", aggregation }],
            timeScale: 60,
          }),
        ).toThrow(/cannot serve aggregation/);
      }
    });
  });

  it("uses toStartOfInterval on BucketStart for hourly buckets", () => {
    expect(sql).toMatch(
      /toStartOfInterval\(ra\.BucketStart,\s*INTERVAL\s*1\s*HOUR/,
    );
  });
});

describe("buildSlimTimeseriesQuery", () => {
  const { sql, params } = buildSlimTimeseriesQuery({
    projectId: "tenant-slim",
    ...baseDates,
    series: [
      { metric: "performance.completion_time", aggregation: "p95" },
      { metric: "performance.total_cost", aggregation: "sum" },
    ],
    groupBy: "topics.topics",
    timeScale: 1440,
    filters: { "metadata.user_id": ["alice"] },
  });

  it("emits the deduped FROM trace_analytics IN-tuple pattern", () => {
    expect(sql).toContain("FROM trace_analytics");
    expect(sql).toContain("(TenantId, TraceId, UpdatedAt) IN (");
    expect(sql).toMatch(/GROUP BY\s+TenantId,\s*TraceId/);
  });

  it("filters on TenantId first", () => {
    expect(sql).toMatch(/ta\.TenantId\s*=\s*\{tenantId:String\}/);
  });

  /**
   * The fold's store writes a row for every state it is handed, including one
   * whose only signal is a topic or an annotation, because that is what makes
   * an absent row proof the trace was never committed. Every row on this table
   * counts as A TRACE to the aggregates below, so this predicate is the only
   * thing standing between the always-write row and the product's numbers.
   */
  /** @scenario absence is authoritative because nothing is ever gated out */
  it("keeps dimension-only rows out via the has-signal predicate", () => {
    expect(sql).toContain(TRACE_ANALYTICS_HAS_SIGNAL_SQL);
  });

  it("filters on the partition column OccurredAt for partition pruning", () => {
    expect(sql).toContain("OccurredAt >= {currentStart:DateTime64(3)}");
    expect(sql).toContain("OccurredAt >= {previousStart:DateTime64(3)}");
  });

  it("uses quantileExact for percentile aggregations on slim", () => {
    expect(sql).toContain("quantileExact(0.95)(ta.TotalDurationMs)");
  });

  describe("when grouped by metadata.model", () => {
    // Model group-bys need per-SPAN attribution (the legacy builder's
    // span-model partition join) so buckets sum exactly to the ungrouped
    // totals. Slim has no span data: the router must never send model
    // group-bys here, and the builder throws as the backstop.
    it("throws: the router should have routed model group-bys to trace_summaries", () => {
      expect(() =>
        buildSlimTimeseriesQuery({
          projectId: "tenant-slim",
          ...baseDates,
          series: [{ metric: "performance.total_cost", aggregation: "sum" }],
          groupBy: "metadata.model",
          timeScale: 1440,
        }),
      ).toThrow(/cannot group by "metadata\.model"/);
    });

    it("still emits HAVING for group-bys legacy filters, e.g. topics", () => {
      expect(sql).toContain("HAVING group_key != ''");
    });
  });

  it("uses sum(ta.TotalCost) for additive aggregations on slim", () => {
    expect(sql).toContain("sum(ta.TotalCost)");
  });

  it("reads the slim typed UserId column (not Attributes[…]) for the user filter", () => {
    expect(sql).toContain("ta.UserId IN (");
  });

  it("groups by topic via the typed TopicId column", () => {
    expect(sql).toContain("ta.TopicId");
  });

  it("passes the user-filter values through a parameter binding", () => {
    const userParam = Object.entries(params).find(
      ([k, v]) =>
        k.startsWith("slim_user_") &&
        Array.isArray(v) &&
        (v as string[]).includes("alice"),
    );
    expect(userParam).toBeDefined();
  });
});
