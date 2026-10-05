/**
 * `metadata.key` / `metadata.value` filters on both tables a graph reads, seeded with every
 * storage format (`metadata.<key>`, `langwatch.metadata.<key>`, bare `<key>`) trace search reads.
 * @integration
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";
import { buildSlimTimeseriesQuery } from "../clickhouse.slim-timeseries-query.mapper.ts";

/** Unique per run: the migrated endpoint is shared, so tenant ids keep suites apart. */
const TENANT_ID = `test-analytics-metadata-filters-${randomUUID()}`;
const T0 = Date.now() - 60 * 60 * 1000;
const WINDOW = {
  projectId: TENANT_ID,
  startDate: new Date(T0 - 24 * 60 * 60 * 1000),
  endDate: new Date(T0 + 24 * 60 * 60 * 1000),
  previousPeriodStartDate: new Date(T0 - 48 * 60 * 60 * 1000),
  timeScale: "full" as const,
};

/** One trace per storage format, one without `outcome`, one whose `outcome` is empty. */
const TRACES = [
  { id: "sdk", attributes: { "metadata.outcome": "ok" } },
  { id: "rest", attributes: { "langwatch.metadata.outcome": "fail" } },
  { id: "otel", attributes: { outcome: "ok" } },
  { id: "none", attributes: { "metadata.other": "x" } },
  { id: "empty", attributes: { "metadata.outcome": "" } },
] as const;

type SeededTrace = (typeof TRACES)[number];

const SERIES: AnalyticsSeries & { alias: string } = {
  metric: "metadata.trace_id",
  aggregation: "cardinality",
  alias: "0__metadata_trace_id__cardinality",
};

const SEEDED_TABLES = ["trace_summaries", "trace_analytics"] as const;

const traceId = (trace: SeededTrace) => `${TENANT_ID}-${trace.id}`;

function traceSummaryRow(trace: SeededTrace) {
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

/** The slim row with only the columns these reads touch; the rest take their defaults. */
function traceAnalyticsRow(trace: SeededTrace) {
  return {
    TenantId: TENANT_ID,
    TraceId: traceId(trace),
    Version: "v1",
    OccurredAt: new Date(T0),
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
    TraceName: "metadata filter trace",
    TotalDurationMs: 100,
    SpanCount: 1,
    EarliestSpanStartMs: T0,
    Attributes: trace.attributes,
  };
}

const BUILDERS = [
  ["trace_summaries", buildTimeseriesQuery],
  ["trace_analytics", buildSlimTimeseriesQuery],
] as const;

type Filters = Parameters<typeof buildTimeseriesQuery>[0]["filters"];

describe("analytics metadata filters", () => {
  let ch: ClickHouseClient;

  async function deleteTenantRows(): Promise<void> {
    await deleteMigratedTenantRows({ client: ch, tenantId: TENANT_ID, tables: SEEDED_TABLES });
  }

  beforeAll(async () => {
    ch = (await startMigratedClickHouse()).client;
    await deleteTenantRows();
    await ch.insert({
      table: "trace_summaries",
      values: TRACES.map(traceSummaryRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    await ch.insert({
      table: "trace_analytics",
      values: TRACES.map(traceAnalyticsRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 60_000);

  afterAll(async () => {
    await deleteTenantRows();
  });

  describe.each(BUILDERS)("when the graph reads %s", (_, build) => {
    /** Traces the series counts in the current period under `filters`. */
    const countWith = async (filters: Filters): Promise<number> => {
      resetParamCounter();
      const { sql, params } = build({ ...WINDOW, series: [SERIES], filters });
      const result = await ch.query({ query: sql, query_params: params, format: "JSONEachRow" });
      const rows = await result.json<Record<string, number | string>>();
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
