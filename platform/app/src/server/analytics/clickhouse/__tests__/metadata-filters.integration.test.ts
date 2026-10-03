/**
 * Analytics `metadata.key` / `metadata.value` filters, executed against seeded
 * rows on both tables a graph can read: `trace_summaries` and the slim
 * `trace_analytics`.
 *
 * Custom metadata is stored under one of three keys depending on how it was
 * sent: `metadata.<key>` (the SDKs today), `langwatch.metadata.<key>` (the
 * legacy REST collector) or the bare `<key>` (a legacy OTEL resource
 * attribute). Trace search reads all three; analytics read only the bare key,
 * so a graph filtered by a metadata key the SDK sent counted nothing.
 *
 * @see https://github.com/langwatch/tasks/issues/919
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSlimTimeseriesQuery } from "~/server/app-layer/analytics/query-builders/slim-timeseries-query";
import type { AnalyticsTimeseriesBuilderInput } from "~/server/app-layer/analytics/types";
import { TraceAnalyticsClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-analytics.clickhouse.repository";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsRow,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import { getTestClickHouseClient } from "../../../event-sourcing/__tests__/integration/testContainers";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import { buildTimeseriesQuery } from "../aggregation-builder";
import { resetParamCounter } from "../filter-translator";

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
] as const;

const SERIES = {
  metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
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

function traceAnalyticsRow(trace: (typeof TRACES)[number]): TraceAnalyticsRow {
  return {
    tenantId: TENANT_ID,
    traceId: traceId(trace),
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
    hasSignal: true,
    occurredAtMs: T0,
    createdAtMs: T0,
    updatedAtMs: T0,
    traceName: "metadata filter trace",
    topicId: null,
    subTopicId: null,
    userId: null,
    conversationId: null,
    customerId: null,
    origin: "",
    models: [],
    labels: [],
    totalCost: 0,
    nonBilledCost: 0,
    totalDurationMs: 100,
    timeToFirstTokenMs: null,
    tokensPerSecond: null,
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    hasError: false,
    hasAnnotation: null,
    spanCount: 1,
    annotationIds: [],
    rootSpanStartTimeMs: 0,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    traceNameUserOverridden: false,
    lastEventOccurredAt: T0,
    earliestSpanStartMs: T0,
    attributes: { ...trace.attributes },
  };
}

type Filters = AnalyticsTimeseriesBuilderInput["filters"];

const BUILDERS = [
  ["trace_summaries", buildTimeseriesQuery],
  ["trace_analytics", buildSlimTimeseriesQuery],
] as const;

describe("analytics metadata filters", () => {
  let ch: ClickHouseClient;

  async function deleteTenantRows(): Promise<void> {
    for (const table of ["trace_summaries", "trace_analytics"] as const) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String} SETTINGS mutations_sync = 1`,
        query_params: { tenantId: TENANT_ID },
      });
    }
  }

  beforeAll(async () => {
    const rawClient = getTestClickHouseClient();
    if (!rawClient) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(rawClient);
    await deleteTenantRows();
    await ch.insert({
      table: "trace_summaries",
      values: TRACES.map(traceSummaryRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    await new TraceAnalyticsClickHouseRepository(async () => ch).upsertBatch(
      TRACES.map((trace) => ({ row: traceAnalyticsRow(trace) })),
    );
    await ch.exec({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
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

    it("counts a metadata key in any of the three storage formats", async () => {
      expect(await countWith({ "metadata.key": ["outcome"] })).toBe(3);
    });

    it("counts a metadata value in any storage format", async () => {
      expect(await countWith({ "metadata.value": { outcome: ["ok"] } })).toBe(
        2,
      );
    });

    it("reads the legacy collector's format too", async () => {
      expect(await countWith({ "metadata.value": { outcome: ["fail"] } })).toBe(
        1,
      );
    });
  });
});
