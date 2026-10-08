/**
 * Default-dashboard panels on a high-volume project, run under a memory cap.
 *
 * Seeds about a million traces over the current and previous 30-day windows
 * (half of them with a second version, as the fold writes them) and runs the
 * SQL each default panel sends, routed the way the service routes it, with a
 * per-query cap far below what the dedup set of that many traces needs. The
 * panels must answer, and answer with the right counts.
 *
 * The cap is scaled down with the data: production caps a query at 1.5 to
 * 2 GiB and spills aggregations at 500 MB, and a project with tens of millions
 * of traces in range hits the cap the same way this one hits 150 MB.
 *
 * @see specs/analytics/clickhouse-memory-safety.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTimeseriesQuery,
  buildTopDocumentsQuery,
} from "~/server/analytics/clickhouse/aggregation-builder";
import { resetParamCounter } from "~/server/analytics/clickhouse/filter-translator";
import type { TimeseriesInputType } from "~/server/analytics/registry";
import { currentVsPreviousDates } from "~/server/api/routers/analytics/common";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { adjustTimeScaleForBucketCap } from "../query-builders/_shared";
import { buildEvalSlimTimeseriesQuery } from "../query-builders/eval-slim-timeseries-query";
import { buildSlimTimeseriesQuery } from "../query-builders/slim-timeseries-query";
import { pickAnalyticsTable } from "../routing/route-table";

const TENANT_ID = `acme-dashboard-memory-${nanoid(8)}`;
const TRACE_COUNT = 1_000_000;
const DAY_MS = 86_400_000;
const RANGE_DAYS = 30;

/** Every 5th trace carries RAG contexts on its root span. */
const RAG_TRACE_EVERY = 5;
const RAG_DOCUMENT_COUNT = 2_000;

/** The scaled-down `max_bytes_in_join` for a query that spills its join. */
const SCALED_JOIN_BYTES = "30000000";

const CAPPED_SETTINGS = {
  max_threads: 2,
  max_memory_usage: "150000000",
  max_bytes_before_external_group_by: "30000000",
} as const;

const end = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS);
const start = new Date(end.getTime() - RANGE_DAYS * DAY_MS);
const seedSpanMs = 2 * RANGE_DAYS * DAY_MS;

type PanelInput = Omit<
  TimeseriesInputType,
  "projectId" | "startDate" | "endDate" | "filters" | "timeZone"
>;

function panelInput(panel: PanelInput): TimeseriesInputType {
  return {
    projectId: TENANT_ID,
    startDate: start.getTime(),
    endDate: end.getTime(),
    filters: {},
    timeZone: "UTC",
    ...panel,
  } as TimeseriesInputType;
}

/** The SQL the service sends for this panel, on the table it routes to. */
function buildPanelQuery(input: TimeseriesInputType) {
  const table = pickAnalyticsTable({
    series: input.series,
    filters: input.filters,
    groupBy: input.groupBy,
  });
  const { previousPeriodStartDate, startDate, endDate } =
    currentVsPreviousDates(
      input,
      typeof input.timeScale === "number" ? input.timeScale : undefined,
    );
  const builderInput = {
    ...input,
    startDate,
    endDate,
    previousPeriodStartDate,
    timeScale: adjustTimeScaleForBucketCap({
      timeScale: input.timeScale,
      startDate,
      endDate,
    }),
  };
  resetParamCounter();
  switch (table) {
    case "trace_analytics":
      return { table, ...buildSlimTimeseriesQuery(builderInput) };
    case "evaluation_analytics":
      return { table, ...buildEvalSlimTimeseriesQuery(builderInput) };
    case "trace_summaries":
    case "evaluation_runs":
      return { table, ...buildTimeseriesQuery(builderInput) };
    default:
      throw new Error(`panel routed to an unexpected table: ${table}`);
  }
}

async function runCapped<T>(
  ch: ClickHouseClient,
  query: {
    sql: string;
    params: Record<string, unknown>;
    settings?: Record<string, string | number>;
  },
): Promise<T[]> {
  const result = await ch.query({
    query: query.sql,
    query_params: query.params,
    format: "JSONEachRow",
    // The query's own settings first, as the repository merges them. The cap
    // and the spill thresholds are scaled down with the data, the join budget
    // of a spilling join included.
    clickhouse_settings: {
      ...query.settings,
      ...CAPPED_SETTINGS,
      ...(query.settings?.max_bytes_in_join
        ? { max_bytes_in_join: SCALED_JOIN_BYTES }
        : {}),
    },
  });
  return result.json<T>();
}

/** The single series value of a result row, whatever its alias. */
function seriesValue(row: Record<string, unknown>): unknown {
  return Object.entries(row).find(
    ([key]) => !["period", "date", "group_key"].includes(key),
  )?.[1];
}

/**
 * Trace and user counts on the slim table are `uniq` (HyperLogLog), so they
 * land within a fraction of a percent of the exact count rather than on it.
 */
function relativeError(actual: number, exact: number): number {
  return Math.abs(actual - exact) / exact;
}

describe("dashboard panels under a memory cap", () => {
  let ch: ClickHouseClient;
  const expected = {
    currentTraces: 0,
    previousTraces: 0,
    currentErrorTraces: 0,
    currentUsers: 0,
  };

  beforeAll(async () => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("ClickHouse client not available");
    ch = client;

    // Trace t occurs t * 60d / N before `end`, so the traces fill both
    // windows evenly. Even traces get a second, newer version.
    const occurredAt = `toDateTime64({end:DateTime64(3)}, 3) - toIntervalMillisecond(intDiv(t * ${seedSpanMs}, ${TRACE_COUNT}) + 1)`;
    const traceId = "lower(hex(MD5(concat({tenantId:String}, toString(t)))))";
    const params = { tenantId: TENANT_ID, end };

    await ch.exec({
      query: `
        INSERT INTO trace_analytics (TenantId, TraceId, Version, OccurredAt, UpdatedAt, TraceName, UserId, ConversationId, Origin, Models, TotalCost, TotalDurationMs, TimeToFirstTokenMs, PromptTokens, CompletionTokens, HasError, Attributes, SpanCount)
        SELECT {tenantId:String}, ${traceId}, '2026-09-01', ${occurredAt} AS occ,
          occ + toIntervalSecond(v * 30),
          concat('agent-', toString(t % 40)), concat('user-', toString(t % 50000)), concat('thread-', toString(intDiv(t, 4))),
          'application', ['gpt-5-mini'], 0.001 * (t % 7), (t * 13) % 60000, (t * 7) % 3000, 1000 + t % 500, 200 + t % 300,
          (t % 50) = 0,
          map('metadata.user_id', concat('user-', toString(t % 50000)), 'metadata.thread_id', concat('thread-', toString(intDiv(t, 4)))),
          2 + v
        FROM (SELECT number AS t FROM numbers(${TRACE_COUNT})) ARRAY JOIN [0, 1] AS v
        WHERE v = 0 OR t % 2 = 0
      `,
      query_params: params,
    });

    await ch.exec({
      query: `
        INSERT INTO trace_summaries (ProjectionId, TenantId, TraceId, Version, Attributes, OccurredAt, UpdatedAt, TotalDurationMs, TimeToFirstTokenMs, SpanCount, ContainsErrorStatus, ContainsOKStatus, Models, TotalCost, TokensEstimated, TotalPromptTokenCount, TotalCompletionTokenCount, TraceName)
        SELECT tid, {tenantId:String}, tid, '2026-09-01',
          map('langwatch.user_id', concat('user-', toString(t % 50000)), 'gen_ai.conversation.id', concat('thread-', toString(intDiv(t, 4)))),
          occ, occ, (t * 13) % 60000, (t * 7) % 3000, if(t % ${RAG_TRACE_EVERY} = 0, 2, 1), (t % 50) = 0, 1,
          [if(t % 3 = 0, 'gpt-5-mini', 'claude-sonnet-4')], 0.001 * (t % 7), 0, 1000 + t % 500, 200 + t % 300,
          concat('agent-', toString(t % 40))
        FROM (SELECT number AS t, ${traceId} AS tid, ${occurredAt} AS occ FROM numbers(${TRACE_COUNT}))
      `,
      query_params: params,
    });

    await ch.exec({
      query: `
        INSERT INTO stored_spans (ProjectionId, TenantId, TraceId, SpanId, Sampled, StartTime, EndTime, DurationMs, SpanName, SpanKind, ServiceName, SpanAttributes, ScopeName)
        SELECT tid, {tenantId:String}, tid, concat(tid, '-root'), 1, occ, occ + toIntervalMillisecond(500), 500, 'agent', 1, 'agent-service',
          map('langwatch.span.type', 'agent',
              'langwatch.rag.contexts', concat('[{"document_id":"doc-', toString(intDiv(t, ${RAG_TRACE_EVERY}) % ${RAG_DOCUMENT_COUNT}), '","content":"', repeat('lorem ipsum ', 5), '"}]'),
              'gen_ai.input.messages', repeat('please refactor this module and run the tests ', 20)),
          ''
        FROM (SELECT number AS t, ${traceId} AS tid, ${occurredAt} AS occ FROM numbers(${TRACE_COUNT}))
        WHERE t % ${RAG_TRACE_EVERY} = 0
      `,
      query_params: params,
    });

    await ch.exec({
      query: `
        INSERT INTO stored_spans (ProjectionId, TenantId, TraceId, SpanId, Sampled, StartTime, EndTime, DurationMs, SpanName, SpanKind, ServiceName, SpanAttributes, ScopeName, Cost)
        SELECT tid, {tenantId:String}, tid, concat(tid, '-llm'), 1, occ, occ + toIntervalMillisecond(400), 400, 'llm', 1, 'agent-service',
          map('langwatch.span.type', 'llm',
              'gen_ai.response.model', if(t % 3 = 0, 'gpt-5-mini', 'claude-sonnet-4'),
              'gen_ai.usage.input_tokens', toString(1000 + t % 500),
              'gen_ai.usage.output_tokens', toString(200 + t % 300)),
          '', 0.001 * (t % 7)
        FROM (SELECT number AS t, ${traceId} AS tid, ${occurredAt} AS occ FROM numbers(${TRACE_COUNT}))
      `,
      query_params: params,
    });

    // Ground truth straight from the seed, without any dedup machinery: the
    // second version of a trace keeps its OccurredAt.
    const [truth] = await (
      await ch.query({
        query: `
          SELECT
            uniqExactIf(TraceId, OccurredAt >= {start:DateTime64(3)}) AS currentTraces,
            uniqExactIf(TraceId, OccurredAt < {start:DateTime64(3)}) AS previousTraces,
            uniqExactIf(TraceId, OccurredAt >= {start:DateTime64(3)} AND HasError) AS currentErrorTraces,
            uniqExactIf(UserId, OccurredAt >= {start:DateTime64(3)}) AS currentUsers
          FROM trace_analytics
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= {previousStart:DateTime64(3)} AND OccurredAt < {end:DateTime64(3)}
        `,
        query_params: {
          tenantId: TENANT_ID,
          start,
          end,
          previousStart: new Date(start.getTime() - RANGE_DAYS * DAY_MS),
        },
        format: "JSONEachRow",
      })
    ).json<Record<keyof typeof expected, string>>();
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      expected[key] = Number(truth?.[key]);
    }
    if (expected.currentTraces < 400_000) {
      throw new Error(
        `seed produced ${expected.currentTraces} traces in the current window`,
      );
    }
  }, 240_000);

  afterAll(async () => {
    if (!ch) return;
    for (const table of [
      "trace_analytics",
      "trace_summaries",
      "stored_spans",
    ]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: TENANT_ID },
      });
    }
  }, 120_000);

  describe("when the trace count summary compares against the previous period", () => {
    /** @scenario Dashboard panels on a high-volume project answer under a memory cap */
    it("returns the current and previous trace counts", async () => {
      const query = buildPanelQuery(
        panelInput({
          series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
          timeScale: "full",
        } as PanelInput),
      );
      expect(query.table).toBe("trace_analytics");

      const rows = await runCapped<Record<string, unknown>>(ch, query);
      const count = (period: string) =>
        Number(
          seriesValue(rows.find((row) => row.period === period) ?? {}) ?? 0,
        );
      expect(
        relativeError(count("current"), expected.currentTraces),
      ).toBeLessThan(0.02);
      expect(
        relativeError(count("previous"), expected.previousTraces),
      ).toBeLessThan(0.02);
    }, 120_000);
  });

  describe("when the users summary counts distinct users", () => {
    /** @scenario Dashboard panels on a high-volume project answer under a memory cap */
    it("returns the distinct user count", async () => {
      const query = buildPanelQuery(
        panelInput({
          series: [{ metric: "metadata.user_id", aggregation: "cardinality" }],
          timeScale: "full",
        } as PanelInput),
      );
      expect(query.table).toBe("trace_analytics");

      const rows = await runCapped<Record<string, unknown>>(ch, query);
      const value = seriesValue(
        rows.find((row) => row.period === "current") ?? {},
      );
      expect(relativeError(Number(value), expected.currentUsers)).toBeLessThan(
        0.02,
      );
    }, 120_000);
  });

  describe("when the error trend groups traces by error state", () => {
    /** @scenario Dashboard panels on a high-volume project answer under a memory cap */
    it("routes to the slim table and counts the failed traces", async () => {
      const query = buildPanelQuery(
        panelInput({
          series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
          timeScale: 1440,
          groupBy: "error.has_error",
          skipPreviousPeriod: true,
        } as PanelInput),
      );
      expect(query.table).toBe("trace_analytics");

      const rows = await runCapped<Record<string, unknown>>(ch, query);
      const withError = rows
        .filter(
          (row) => row.period === "current" && row.group_key === "with error",
        )
        .reduce((sum, row) => sum + Number(seriesValue(row)), 0);
      expect(
        relativeError(withError, expected.currentErrorTraces),
      ).toBeLessThan(0.02);
      expect(rows.some((row) => row.period === "previous")).toBe(false);
    }, 120_000);
  });

  describe("when the latency trend reads percentiles", () => {
    /** @scenario Dashboard panels on a high-volume project answer under a memory cap */
    it("answers within the cap", async () => {
      const query = buildPanelQuery(
        panelInput({
          series: [
            { metric: "performance.completion_time", aggregation: "median" },
            { metric: "performance.first_token", aggregation: "median" },
          ],
          timeScale: 1440,
          skipPreviousPeriod: true,
        } as PanelInput),
      );
      expect(query.table).toBe("trace_analytics");

      const rows = await runCapped<Record<string, unknown>>(ch, query);
      expect(rows.length).toBeGreaterThanOrEqual(RANGE_DAYS);
    }, 120_000);
  });

  describe("when the thread metrics read the legacy trace table", () => {
    /** @scenario Dashboard panels on a high-volume project answer under a memory cap */
    it("answers within the cap", async () => {
      const query = buildPanelQuery(
        panelInput({
          series: [
            { metric: "metadata.thread_id", aggregation: "cardinality" },
            {
              metric: "metadata.trace_id",
              aggregation: "cardinality",
              pipeline: { field: "thread_id", aggregation: "avg" },
            },
            {
              metric: "threads.average_duration_per_thread",
              aggregation: "avg",
            },
          ],
          timeScale: "full",
        } as PanelInput),
      );
      expect(query.table).toBe("trace_summaries");

      const rows = await runCapped<Record<string, unknown>>(ch, query);
      expect(rows.some((row) => row.period === "current")).toBe(true);
    }, 120_000);
  });

  describe("when the LLM calls chart groups traces by model", () => {
    /** @scenario The model-grouped chart answers under a memory cap */
    it("counts every current trace under its model within the cap", async () => {
      const query = buildPanelQuery(
        panelInput({
          series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
          timeScale: 1440,
          groupBy: "metadata.model",
          skipPreviousPeriod: true,
        } as PanelInput),
      );
      expect(query.table).toBe("trace_summaries");

      const rows = await runCapped<Record<string, unknown>>(ch, query);
      const perModel = new Map<string, number>();
      for (const row of rows.filter((r) => r.period === "current")) {
        const model = String(row.group_key);
        perModel.set(
          model,
          (perModel.get(model) ?? 0) + Number(seriesValue(row)),
        );
      }
      expect([...perModel.keys()].sort()).toEqual([
        "claude-sonnet-4",
        "gpt-5-mini",
      ]);
      const total = [...perModel.values()].reduce((sum, n) => sum + n, 0);
      expect(total).toBe(expected.currentTraces);
    }, 180_000);
  });

  describe("when the documents panel ranks RAG documents", () => {
    /** @scenario The documents panel reads only the RAG contexts attribute */
    it("answers within the cap with the exact distinct document total", async () => {
      resetParamCounter();
      const query = buildTopDocumentsQuery(TENANT_ID, start, end, {});
      const rows = await runCapped<{
        documentId: string;
        count: string;
        total: string;
      }>(ch, query);
      expect(rows).toHaveLength(10);
      expect(Number(rows[0]?.total)).toBe(RAG_DOCUMENT_COUNT);
      expect(Number(rows[0]?.count)).toBeGreaterThan(0);
    }, 120_000);
  });
});
