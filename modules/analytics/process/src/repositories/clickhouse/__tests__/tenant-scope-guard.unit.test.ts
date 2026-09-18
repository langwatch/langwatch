/**
 * Runs the shared ClickHouse tenant guard against the real SQL each
 * timeseries builder produces, so a subquery-nested predicate can never
 * silently trade places with a same-depth OR again.
 * @regression project-home-500s (analytics.getTimeseries 500)
 */
import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { checkTenantScope } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { buildEvalSlimTimeseriesQuery } from "../clickhouse.eval-slim-timeseries-query.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";
import { buildSlimTimeseriesQuery } from "../clickhouse.slim-timeseries-query.mapper.ts";

const dates = {
  startDate: new Date("2026-06-15T00:00:00.000Z"),
  endDate: new Date("2026-06-16T00:00:00.000Z"),
  previousPeriodStartDate: new Date("2026-06-14T00:00:00.000Z"),
};

describe("tenant scope guard vs the timeseries builders", () => {
  it("passes buildTimeseriesQuery with no filters — the reported crash", () => {
    resetParamCounter();
    const { sql, params } = buildTimeseriesQuery({
      projectId: "tenant-a",
      ...dates,
      series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
      timeScale: 60,
    });

    expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
  });

  it("passes buildTimeseriesQuery when a filter clause carries its own OR", () => {
    resetParamCounter();
    const { sql, params } = buildTimeseriesQuery({
      projectId: "tenant-a",
      ...dates,
      series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
      timeScale: 60,
      filters: { "traces.error": ["false"] },
    });

    expect(sql).toContain("ContainsErrorStatus = 0 OR");
    expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
  });

  it("passes buildTimeseriesQuery on the timeScale=full CTE path", () => {
    resetParamCounter();
    const { sql, params } = buildTimeseriesQuery({
      projectId: "tenant-a",
      ...dates,
      series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
      timeScale: "full",
    });

    expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
  });

  it("passes buildSlimTimeseriesQuery with no filters", () => {
    const { sql, params } = buildSlimTimeseriesQuery({
      projectId: "tenant-a",
      ...dates,
      series: [{ metric: "performance.total_cost", aggregation: "sum" }],
      timeScale: 60,
    });

    expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
  });

  it("passes buildSlimTimeseriesQuery when a filter clause carries its own OR", () => {
    const { sql, params } = buildSlimTimeseriesQuery({
      projectId: "tenant-a",
      ...dates,
      series: [{ metric: "performance.total_cost", aggregation: "sum" }],
      timeScale: 60,
      filters: { "metadata.key": ["a", "b"] },
    });

    expect(sql).toContain(" OR ");
    expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
  });

  it("passes buildEvalSlimTimeseriesQuery when a filter clause carries its own OR", () => {
    const { sql, params } = buildEvalSlimTimeseriesQuery({
      projectId: "tenant-a",
      ...dates,
      series: [{ metric: "evaluations.evaluation_score", aggregation: "avg" } as AnalyticsSeries],
      timeScale: 60,
      filters: { "metadata.key": ["a", "b"] },
    });

    expect(sql).toContain(" OR ");
    expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
  });
});
