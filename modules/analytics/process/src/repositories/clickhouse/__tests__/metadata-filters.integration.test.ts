/**
 * `metadata.key` / `metadata.value` on both graph tables read all three storage formats (#919).
 * @integration
 * @vitest-environment node
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import {
  buildTimeseriesQuery,
  type TimeseriesQueryInput,
} from "../clickhouse.aggregation-builder.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";
import { buildSlimTimeseriesQuery } from "../clickhouse.slim-timeseries-query.mapper.ts";

const TENANT_ID = "test-analytics-metadata-filters-919";
const T0 = Math.floor((Date.now() - 60 * 60 * 1000) / 60_000) * 60_000;
const WINDOW = {
  projectId: TENANT_ID,
  startDate: new Date(T0 - 24 * 60 * 60 * 1000),
  endDate: new Date(T0 + 24 * 60 * 60 * 1000),
  previousPeriodStartDate: new Date(T0 - 48 * 60 * 60 * 1000),
  timeScale: "full" as const,
};

/** One trace per storage format, plus one with no `outcome` at all. */
const TRACES = [
  { id: "sdk", attributes: { "metadata.outcome": "ok" } },
  { id: "rest", attributes: { "langwatch.metadata.outcome": "fail" } },
  { id: "otel", attributes: { outcome: "ok" } },
  { id: "none", attributes: { "metadata.other": "x" } },
  { id: "empty", attributes: { "metadata.outcome": "" } },
] as const;

const SERIES = {
  metric: "metadata.trace_id",
  aggregation: "cardinality" as const,
  alias: "0__metadata_trace_id__cardinality",
};

const traceId = (trace: (typeof TRACES)[number]) => `${TENANT_ID}-${trace.id}`;

function traceSummaryRow(trace: (typeof TRACES)[number]) {
  return {
    ProjectionId: `proj-${TENANT_ID}-${trace.id}`,
    TenantId: TENANT_ID,
    TraceId: traceId(trace),
    Version: "v1",
    Attributes: trace.attributes,
    OccurredAt: new Date(T0),
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    Models: [],
  };
}

/** The `trace_analytics` columns the slim builder reads; the rest take their defaults. */
function traceAnalyticsRow(trace: (typeof TRACES)[number]) {
  return {
    TenantId: TENANT_ID,
    TraceId: traceId(trace),
    Version: "2026-10-05",
    OccurredAt: new Date(T0),
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
    TraceName: "metadata filter trace",
    Origin: "",
    Models: [],
    Labels: [],
    TotalDurationMs: 100,
    HasError: false,
    SpanCount: 1,
    EarliestSpanStartMs: T0,
    Attributes: { ...trace.attributes },
  };
}

type Filters = TimeseriesQueryInput["filters"];

const BUILDERS = [
  ["trace_summaries", buildTimeseriesQuery],
  ["trace_analytics", buildSlimTimeseriesQuery],
] as const;

describe("analytics metadata filters", () => {
  let ch: ClickHouseClient;

  const deleteTenantRows = () =>
    deleteMigratedTenantRows({
      client: ch,
      tenantId: TENANT_ID,
      tables: ["trace_summaries", "trace_analytics"],
    });

  beforeAll(async () => {
    ch = (await startMigratedClickHouse()).client;
    await deleteTenantRows();
    for (const [table, row] of [
      ["trace_summaries", traceSummaryRow],
      ["trace_analytics", traceAnalyticsRow],
    ] as const) {
      await ch.insert({
        table,
        values: TRACES.map(row),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    }
  }, 60_000);

  afterAll(async () => {
    await deleteTenantRows();
  });

  describe.each(BUILDERS)("when the graph reads %s", (_, build) => {
    /** Traces the series counts in the current period under `filters`. */
    const countWith = async (filters: Filters): Promise<number> => {
      resetParamCounter();
      const { sql, params } = build({
        ...WINDOW,
        series: [SERIES],
        filters,
      });
      const result = await ch.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Record<string, number | string>[];
      return rows
        .filter((row) => row.period === "current")
        .reduce((sum, row) => sum + Number(row[SERIES.alias] ?? 0), 0);
    };

    it("counts every trace with no metadata filter", async () => {
      expect(await countWith({})).toBe(TRACES.length);
    });

    // The trace whose outcome is empty is not counted.
    it("counts a metadata key in any of the three storage formats", async () => {
      expect(await countWith({ "metadata.key": ["outcome"] })).toBe(3);
    });

    it("counts a metadata value in any storage format", async () => {
      expect(await countWith({ "metadata.value": { outcome: ["ok"] } })).toBe(2);
    });

    it("reads the legacy collector's format too", async () => {
      expect(await countWith({ "metadata.value": { outcome: ["fail"] } })).toBe(1);
    });

    it("counts nothing for values sent without a key", async () => {
      expect(await countWith({ "metadata.value": ["ok"] })).toBe(0);
    });
  });
});
