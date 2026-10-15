/**
 * Runs the shared ClickHouse tenant guard against the real SQL each
 * timeseries builder produces, so a subquery-nested predicate can never
 * silently trade places with a same-depth OR again.
 * @regression project-home-500s (analytics.getTimeseries 500)
 */
import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { checkTenantScope, expandStatement, fenceFor } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { pickAnalyticsTable } from "../clickhouse.analytics-route-table.mapper.ts";
import { buildEvalRollupTimeseriesQuery } from "../clickhouse.eval-rollup-timeseries-query.mapper.ts";
import { buildEvalSlimTimeseriesQuery } from "../clickhouse.eval-slim-timeseries-query.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";
import { buildSlimTimeseriesQuery } from "../clickhouse.slim-timeseries-query.mapper.ts";

const dates = {
  startDate: new Date("2026-06-15T00:00:00.000Z"),
  endDate: new Date("2026-06-16T00:00:00.000Z"),
  previousPeriodStartDate: new Date("2026-06-14T00:00:00.000Z"),
};

/** The fences a routed read runs under: the project alone, and an aggregate with one member. */
const FENCES = {
  own: fenceFor({ authorization: analyticsProof({ projectId: "tenant-a" }), reads: "analytics" }),
  aggregate: fenceFor({
    authorization: analyticsProof({
      projectId: "tenant-a",
      shared: [{ projectId: "member-b", from: Date.UTC(2026, 5, 1) }],
    }),
    reads: "analytics",
  }),
};

/**
 * A fenced builder's statement as the reader sends it: markers expanded into the fence, then
 * the guard asked about the tenant set the reader declares.
 */
function fencedViolations(built: { sql: string; params: Record<string, unknown> }) {
  return Object.values(FENCES).map((fence) => {
    const expanded = expandStatement({ query: built.sql, queryParams: built.params, fence });
    return checkTenantScope({
      sql: expanded.query,
      params: expanded.queryParams,
      tenantId: "tenant-a",
      tenantIds: [...fence.own, ...fence.shared.map((window) => window.projectId)],
    });
  });
}

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

  describe("given negated filters", () => {
    /** @scenario "Negating a span filter inverts the selection and passes the tenant guard" */
    it.each([
      ["a span model filter", { "spans.model": ["gpt-5-mini"] }],
      ["a span type and a trace name filter", { "spans.type": ["llm"], "traces.name": ["a"] }],
    ])("writes %s as NOT IN and passes the guard", (_label, filters) => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        projectId: "tenant-a",
        ...dates,
        series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
        timeScale: "full",
        filters,
        negateFilters: true,
      });

      expect(sql).toMatch(/ts\.TraceId NOT IN \(\s*SELECT TraceId FROM stored_spans/);
      expect(sql).not.toMatch(/NOT \(\(?ts\.TraceId IN/);
      expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
    });

    it("keeps NOT around a filter without a subquery", () => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        projectId: "tenant-a",
        ...dates,
        series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
        timeScale: "full",
        filters: { "traces.name": ["a"] },
        negateFilters: true,
      });

      expect(sql).toMatch(/NOT \(ts\.TraceName IN/);
      expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
    });
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

    expect(fencedViolations({ sql, params })).toEqual([null, null]);
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
    expect(fencedViolations({ sql, params })).toEqual([null, null]);
  });

  it("passes buildEvalSlimTimeseriesQuery with no filters", () => {
    const { sql, params } = buildEvalSlimTimeseriesQuery({
      projectId: "tenant-a",
      ...dates,
      series: [{ metric: "evaluations.evaluation_score", aggregation: "avg" } as AnalyticsSeries],
      timeScale: 60,
    });

    expect(fencedViolations({ sql, params })).toEqual([null, null]);
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

  describe.each([
    [
      "LLM calls grouped by model",
      { metric: "metadata.trace_id", aggregation: "cardinality" },
      "metadata.model",
      1440,
    ],
    [
      "evaluation runs grouped by pass",
      { metric: "evaluations.evaluation_runs", aggregation: "cardinality" },
      "evaluations.evaluation_passed",
      "full",
    ],
  ])("given the overview's %s (WEB-985)", (_label, series, groupBy, timeScale) => {
    it.each([["buildTimeseriesQuery", buildTimeseriesQuery]])(
      "keeps the tenant predicate undisjoined in %s",
      (_builder, build) => {
        resetParamCounter();
        const { sql, params } = build({
          projectId: "tenant-a",
          ...dates,
          series: [series as AnalyticsSeries],
          groupBy,
          timeScale,
        } as Parameters<typeof buildTimeseriesQuery>[0]);

        expect(checkTenantScope({ sql, params, tenantId: "tenant-a" })).toBeNull();
      },
    );
  });

  // WEB-985: the eval slim builder is still refused; flip to `it` once fixed (routed to fix-hi).
  it("passes the overview's evaluation summary on the table it routes to (WEB-985)", () => {
    const input = {
      projectId: "tenant-a",
      ...dates,
      series: [
        { metric: "evaluations.evaluation_runs", aggregation: "cardinality" },
      ] as AnalyticsSeries[],
      groupBy: "evaluations.evaluation_passed",
      timeScale: "full" as const,
      timeZone: "Europe/Amsterdam",
    };
    const table = pickAnalyticsTable(input);
    const fenced = {
      evaluation_analytics_rollup: buildEvalRollupTimeseriesQuery,
      evaluation_analytics: buildEvalSlimTimeseriesQuery,
    }[table as string];
    resetParamCounter();
    const built = (fenced ?? buildTimeseriesQuery)(
      input as Parameters<typeof buildTimeseriesQuery>[0],
    );

    const violations = fenced
      ? fencedViolations(built)
      : [checkTenantScope({ ...built, tenantId: "tenant-a" })];

    expect(violations.filter((violation) => violation !== null)).toEqual([]);
  });
});
