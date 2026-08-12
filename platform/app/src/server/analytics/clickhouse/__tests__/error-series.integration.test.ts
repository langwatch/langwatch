/**
 * Integration tests for per-series filters and percentage mode (#6718).
 *
 * The ClickHouse timeseries builder dropped a series' own `filters` entirely,
 * so a "traces with errors" series and a "traces without errors" series drew
 * the identical line and the "show in percentages" toggle changed nothing.
 * SQL-shape assertions live in `aggregation-builder.test.ts`; these execute the
 * built query against seeded data, because the shape being different is not the
 * same claim as the numbers being right.
 *
 * @see specs/analytics/error-series.feature
 * @see https://github.com/langwatch/langwatch/issues/6718
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import { getTestClickHouseClient } from "../../../event-sourcing/__tests__/integration/testContainers";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import { buildTimeseriesQuery } from "../aggregation-builder";
import { resetParamCounter } from "../filter-translator";

const TENANT_ID = "test-error-series-6718";

/** Anchor an hour back so every seeded row sits inside the current window. */
const T0 = Date.now() - 60 * 60 * 1000;

const WINDOW = {
  projectId: TENANT_ID,
  startDate: new Date(T0 - 24 * 60 * 60 * 1000),
  endDate: new Date(T0 + 24 * 60 * 60 * 1000),
  previousPeriodStartDate: new Date(T0 - 48 * 60 * 60 * 1000),
  timeScale: "full" as const,
};

/** A window that deliberately contains none of the seeded traces. */
const EMPTY_WINDOW = {
  ...WINDOW,
  startDate: new Date(T0 - 400 * 24 * 60 * 60 * 1000),
  endDate: new Date(T0 - 399 * 24 * 60 * 60 * 1000),
  previousPeriodStartDate: new Date(T0 - 401 * 24 * 60 * 60 * 1000),
};

/**
 * Two traces carry an error, three do not. Two carry an `llm` span (one of each
 * error status) so a span-facet filter can be told apart from the error one.
 */
const TRACES = [
  { id: "err-0", hasError: true, spanType: "llm" },
  { id: "err-1", hasError: true, spanType: "agent" },
  { id: "ok-0", hasError: false, spanType: "llm" },
  { id: "ok-1", hasError: false, spanType: "agent" },
  { id: "ok-2", hasError: false, spanType: "agent" },
] as const;

const TRACES_WITH_ERROR = TRACES.filter((t) => t.hasError).length;
const TRACES_TOTAL = TRACES.length;

const traceCount = (index: number) => ({
  metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
  aggregation: "cardinality" as const,
  alias: `${index}__metadata_trace_id__cardinality`,
});

function traceSummaryRow(trace: (typeof TRACES)[number]) {
  return {
    ProjectionId: `proj-${TENANT_ID}-${trace.id}`,
    TenantId: TENANT_ID,
    TraceId: `${TENANT_ID}-${trace.id}`,
    Version: "v1",
    Attributes: { "metadata.env": "test" },
    OccurredAt: new Date(T0),
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TimeToFirstTokenMs: 50,
    TimeToLastTokenMs: 200,
    TotalDurationMs: 200,
    TokensPerSecond: 100,
    SpanCount: 1,
    ContainsErrorStatus: trace.hasError ? 1 : 0,
    ContainsOKStatus: trace.hasError ? 0 : 1,
    ErrorMessage: trace.hasError ? "boom" : null,
    Models: ["gpt-5-mini"],
    TotalCost: 1,
    TokensEstimated: false,
    TotalPromptTokenCount: 100,
    TotalCompletionTokenCount: 10,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

function storedSpanRow(trace: (typeof TRACES)[number]) {
  return {
    ProjectionId: `proj-span-${TENANT_ID}-${trace.id}`,
    TenantId: TENANT_ID,
    TraceId: `${TENANT_ID}-${trace.id}`,
    SpanId: `${TENANT_ID}-${trace.id}-span`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(T0),
    EndTime: new Date(T0 + 200),
    DurationMs: 200,
    SpanName: trace.id,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: { "langwatch.span.type": trace.spanType },
    StatusCode: trace.hasError ? 2 : 1,
    StatusMessage: "",
    ScopeName: "",
    ScopeVersion: null,
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    Cost: null,
    NonBilledCost: null,
  };
}

describe("per-series filters and percentage mode", () => {
  let ch: ClickHouseClient;

  /** Run a built query and return the row tagged as the current period. */
  const runCurrent = async (
    input: Parameters<typeof buildTimeseriesQuery>[0],
  ): Promise<Record<string, number | string>[]> => {
    resetParamCounter();
    const { sql, params } = buildTimeseriesQuery(input);
    const result = await ch.query({
      query: sql,
      query_params: params,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, number | string>[];
    return rows.filter((row) => row.period === "current");
  };

  const numberAt = (
    row: Record<string, number | string> | undefined,
    alias: string,
  ): number => Number(row?.[alias] ?? 0);

  beforeAll(async () => {
    const rawClient = getTestClickHouseClient();
    if (!rawClient) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(rawClient);

    // Pre-clean: an aborted earlier run leaves its rows behind (afterAll never
    // ran) and a second fixture copy doubles every count assertion.
    for (const table of ["trace_summaries", "stored_spans"] as const) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String} SETTINGS mutations_sync = 1`,
        query_params: { tenantId: TENANT_ID },
      });
    }

    await ch.insert({
      table: "trace_summaries",
      values: TRACES.map(traceSummaryRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    await ch.insert({
      table: "stored_spans",
      values: TRACES.map(storedSpanRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 60_000);

  afterAll(async () => {
    for (const table of ["trace_summaries", "stored_spans"] as const) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String} SETTINGS mutations_sync = 1`,
        query_params: { tenantId: TENANT_ID },
      });
    }
  });

  describe("given a graph with an errors series and a no-errors series", () => {
    describe("when the graph is queried over a window", () => {
      // @scenario "The with-errors and without-errors series partition the window"
      it("reports different counts that add up to every trace in the window", async () => {
        const [withErrors, withoutErrors] = [traceCount(0), traceCount(1)];
        const rows = await runCurrent({
          ...WINDOW,
          series: [
            { ...withErrors, filters: { "traces.error": ["true"] } },
            { ...withoutErrors, filters: { "traces.error": ["false"] } },
          ],
        });

        const errors = numberAt(rows[0], withErrors.alias);
        const nonErrors = numberAt(rows[0], withoutErrors.alias);

        expect(errors).toBe(TRACES_WITH_ERROR);
        expect(nonErrors).toBe(TRACES_TOTAL - TRACES_WITH_ERROR);
        expect(errors).not.toBe(nonErrors);
        expect(errors + nonErrors).toBe(TRACES_TOTAL);
      });

      // @scenario "An alert on the error series counts only traces with errors"
      it("counts only the traces that contain an error", async () => {
        const series = traceCount(0);
        const rows = await runCurrent({
          ...WINDOW,
          series: [{ ...series, filters: { "traces.error": ["true"] } }],
        });

        expect(numberAt(rows[0], series.alias)).toBe(TRACES_WITH_ERROR);
      });
    });
  });

  describe("given a graph with one series filtered by span type", () => {
    describe("when the graph is queried over a window", () => {
      // @scenario "A filter that reads span data still applies to its own series only"
      it("narrows only the filtered series", async () => {
        const [filtered, unfiltered] = [traceCount(0), traceCount(1)];
        const rows = await runCurrent({
          ...WINDOW,
          series: [
            { ...filtered, filters: { "spans.type": ["llm"] } },
            unfiltered,
          ],
        });

        const tracesWithLlmSpan = TRACES.filter(
          (trace) => trace.spanType === "llm",
        ).length;
        expect(numberAt(rows[0], filtered.alias)).toBe(tracesWithLlmSpan);
        expect(numberAt(rows[0], unfiltered.alias)).toBe(TRACES_TOTAL);
      });
    });
  });

  describe("given a filtered series shown as a percentage", () => {
    describe("when the graph is queried over a window", () => {
      // @scenario "Percentage mode divides the filtered series by the unfiltered series"
      it("reports the share of traces in the window that contain an error", async () => {
        const series = traceCount(0);
        const rows = await runCurrent({
          ...WINDOW,
          series: [
            {
              ...series,
              filters: { "traces.error": ["true"] },
              asPercent: true,
            },
          ],
        });

        expect(numberAt(rows[0], series.alias)).toBeCloseTo(
          (TRACES_WITH_ERROR / TRACES_TOTAL) * 100,
          6,
        );
      });
    });

    describe("when the window holds no traces", () => {
      // @scenario "Percentage mode reports zero when the window holds no traces"
      it("reports zero rather than no value at all", async () => {
        const series = traceCount(0);
        const rows = await runCurrent({
          ...EMPTY_WINDOW,
          series: [
            {
              ...series,
              filters: { "traces.error": ["true"] },
              asPercent: true,
            },
          ],
        });

        expect(rows.length).toBeGreaterThan(0);
        expect(numberAt(rows[0], series.alias)).toBe(0);
      });
    });
  });

  describe("given a graph grouped by whether the trace contains an error", () => {
    describe("when the graph is queried over a window", () => {
      // @scenario "Grouping by error status puts each trace in exactly one bucket"
      it("puts each trace in exactly one bucket", async () => {
        const series = traceCount(0);
        const rows = await runCurrent({
          ...WINDOW,
          timeScale: 1440,
          groupBy: "error.has_error",
          series: [series],
        });

        const buckets = new Map<string, number>();
        for (const row of rows) {
          const key = String(row.group_key);
          buckets.set(
            key,
            (buckets.get(key) ?? 0) + numberAt(row, series.alias),
          );
        }

        expect(buckets.get("with error")).toBe(TRACES_WITH_ERROR);
        expect(buckets.get("without error")).toBe(
          TRACES_TOTAL - TRACES_WITH_ERROR,
        );
        expect([...buckets.values()].reduce((a, b) => a + b, 0)).toBe(
          TRACES_TOTAL,
        );
      });
    });
  });
});
