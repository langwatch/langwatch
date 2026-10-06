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

  describe.each([
    ["the evaluator score", "evaluations.evaluation_score"],
    ["the evaluator pass rate", "evaluations.evaluation_pass_rate"],
  ])("given a keyed evaluator series for %s", (_label, metric) => {
    const evaluatorSeries = {
      metric,
      aggregation: "avg",
      key: "evaluator-1",
      filters: { "evaluations.state": { "evaluator-1": ["processed"] } },
    } as AnalyticsSeries;

    it.each([
      ["daily buckets", { timeScale: 1440 as const }],
      ["the full period", { timeScale: "full" as const }],
      [
        "daily buckets grouped by the evaluator",
        {
          timeScale: 1440 as const,
          groupBy: "evaluations.evaluation_passed",
          groupByKey: "evaluator-1",
        },
      ],
      [
        "the full period grouped by the evaluator",
        {
          timeScale: "full" as const,
          groupBy: "evaluations.evaluation_passed",
          groupByKey: "evaluator-1",
        },
      ],
      [
        "daily buckets with a trace filter",
        { timeScale: 1440 as const, filters: { "traces.error": ["false"] } },
      ],
      [
        "the full period with a trace filter",
        { timeScale: "full" as const, filters: { "traces.error": ["false"] } },
      ],
    ])("keeps the tenant predicate undisjoined for %s", (_shape, overrides) => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        projectId: "tenant-a",
        ...dates,
        series: [evaluatorSeries],
        ...overrides,
      } as Parameters<typeof buildTimeseriesQuery>[0]);

      expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
    });
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

  it("passes buildEvalSlimTimeseriesQuery with no filters", () => {
    const { sql, params } = buildEvalSlimTimeseriesQuery({
      projectId: "tenant-a",
      ...dates,
      series: [{ metric: "evaluations.evaluation_score", aggregation: "avg" } as AnalyticsSeries],
      timeScale: 60,
    });

    expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
  });

  it("refuses a filter on the eval slim, which the router sends to evaluation_runs", () => {
    expect(() =>
      buildEvalSlimTimeseriesQuery({
        projectId: "tenant-a",
        ...dates,
        series: [{ metric: "evaluations.evaluation_score", aggregation: "avg" } as AnalyticsSeries],
        timeScale: 60,
        filters: { "metadata.key": ["a", "b"] },
      }),
    ).toThrow(/Eval slim builder cannot serve filter "metadata.key"/);
  });
});
