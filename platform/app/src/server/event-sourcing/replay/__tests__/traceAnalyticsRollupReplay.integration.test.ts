/**
 * Integration test for the replay path that rebuilds `trace_analytics_rollup`.
 *
 * Migration 00065 converts the rollup to the Replicated engine; on clustered
 * deployments it comes out EMPTY and its history is reconstructed by replaying
 * the `traceAnalyticsRollup` map projection over `event_log`
 * (dev/docs/runbooks/analytics-rollup-replay.md). This test pins that recovery
 * path end to end: events seeded into `event_log` are replayed through the
 * REAL replay engine (`runFoldMapReplay` — discovery, streamed batch loading,
 * leaning, the projection's own map handler, and the ClickHouse append store),
 * and the reconstructed rollup rows are asserted against both literal expected
 * values and the projection's direct output for the same events.
 *
 * BDD structure: describe("given X") → describe("when Y") → it("…").
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TraceAnalyticsRollupClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-analytics-rollup.clickhouse.repository";
import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../__tests__/integration/testContainers";
import {
  generateTestAggregateId,
  generateTestTenantId,
} from "../../__tests__/integration/testHelpers";
import { createSpanReceivedEvent } from "../../pipelines/trace-processing/projections/__tests__/fixtures/trace-summary-test.fixtures";
import { TraceAnalyticsRollupMapProjection } from "../../pipelines/trace-processing/projections/traceAnalyticsRollup.mapProjection";
import { TraceAnalyticsRollupAppendStore } from "../../pipelines/trace-processing/projections/traceAnalyticsRollup.store";
import { runFoldMapReplay } from "../replayEngine";
import { nullLog } from "../replayLog";
import { cleanupAll } from "../replayMarkers";
import type { RegisteredMapProjection } from "../types";

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: {
        setAttribute: () => void;
        setAttributes: () => void;
        addEvent: () => void;
      }) => unknown,
    ) =>
      fn({
        setAttribute: () => {},
        setAttributes: () => {},
        addEvent: () => {},
      }),
  }),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const PROJECTION_NAME = "traceAnalyticsRollup";

/** Minute-aligned base a day in the past, inside every retention window. */
const baseMs = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 60_000) * 60_000;
const ms = (offset: number) => baseMs + offset;
const nano = (offset: number) => `${ms(offset)}000000`;

interface RollupTotalsRow {
  bucketMs: number;
  model: string;
  spanType: string;
  spanCount: number;
  traceCount: number;
  errorCount: number;
  durationSum: number;
  promptTokens: number;
  completionTokens: number;
}

/** Rollup totals for the tenant, one normalized row per (bucket, model, type). */
async function readRollupTotals(
  client: ClickHouseClient,
  tenantId: string,
): Promise<RollupTotalsRow[]> {
  const readBack = await client.query({
    query: `
      SELECT
        toUnixTimestamp64Milli(BucketStart) AS bucketMs,
        Model AS model,
        SpanType AS spanType,
        sum(SpanCount) AS spanCount,
        sum(TraceCount) AS traceCount,
        sum(ErrorCount) AS errorCount,
        sum(DurationSum) AS durationSum,
        sum(PromptTokensSum) AS promptTokens,
        sum(CompletionTokensSum) AS completionTokens
      FROM trace_analytics_rollup
      WHERE TenantId = {tenantId:String}
      GROUP BY bucketMs, Model, SpanType
      ORDER BY bucketMs, Model, SpanType
    `,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  const rows = await readBack.json<Record<keyof RollupTotalsRow, string>>();
  return rows.map((r) => ({
    bucketMs: Number(r.bucketMs),
    model: r.model,
    spanType: r.spanType,
    spanCount: Number(r.spanCount),
    traceCount: Number(r.traceCount),
    errorCount: Number(r.errorCount),
    durationSum: Number(r.durationSum),
    promptTokens: Number(r.promptTokens),
    completionTokens: Number(r.completionTokens),
  }));
}

/** Best-effort teardown: replay markers plus the tenant's fixture rows. */
async function cleanupTenantData(
  client: ClickHouseClient | undefined,
  tenantId: string,
): Promise<void> {
  const redis = getTestRedisConnection();
  if (redis) {
    await cleanupAll({ redis, projectionName: PROJECTION_NAME });
  }
  if (!client) return;
  for (const table of ["event_log", "trace_analytics_rollup"]) {
    try {
      await client.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    } catch {
      // best-effort cleanup
    }
  }
}

/** Additive totals over rows, for the replay-vs-direct parity comparison. */
function additiveTotals(
  rows: readonly {
    spanCount: number;
    traceCount: number;
    errorCount: number;
    durationSum: number;
  }[],
) {
  return rows.reduce(
    (a, r) => ({
      spanCount: a.spanCount + r.spanCount,
      traceCount: a.traceCount + r.traceCount,
      errorCount: a.errorCount + r.errorCount,
      durationSum: a.durationSum + r.durationSum,
    }),
    { spanCount: 0, traceCount: 0, errorCount: 0, durationSum: 0 },
  );
}

describe("given span events in event_log for a tenant whose rollup is empty", () => {
  let client: ClickHouseClient;
  let tenantId: string;
  let traceA: string;
  let traceB: string;

  /**
   * Three spans across two traces, shaped by the same fixture the projection's
   * unit tests use, so the raw OTLP payload exercises the real normalization:
   *   - trace A root: response model + span type + tokens, 1500 ms duration.
   *   - trace A child: no model, no type, contributes only its span count.
   *   - trace B root: ERROR status, second minute bucket, 500 ms duration.
   */
  const buildEvents = () => [
    createSpanReceivedEvent({
      eventId: "evt-rollup-replay-001",
      tenantId,
      traceId: traceA,
      spanId: "aaaa000000000001",
      parentSpanId: null,
      occurredAt: ms(0),
      startTimeUnixNano: nano(0),
      endTimeUnixNano: nano(1_500),
      attributes: {
        "gen_ai.request.model": "gpt-4o-mini",
        "gen_ai.response.model": "gpt-4o-2024-08-06",
        "langwatch.span.type": "llm",
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 20,
      },
    }),
    createSpanReceivedEvent({
      eventId: "evt-rollup-replay-002",
      tenantId,
      traceId: traceA,
      spanId: "aaaa000000000002",
      parentSpanId: "aaaa000000000001",
      occurredAt: ms(1_000),
      startTimeUnixNano: nano(10_000),
      endTimeUnixNano: nano(11_000),
    }),
    createSpanReceivedEvent({
      eventId: "evt-rollup-replay-003",
      tenantId,
      traceId: traceB,
      spanId: "cccc000000000001",
      parentSpanId: null,
      occurredAt: ms(2_000),
      startTimeUnixNano: nano(120_000),
      endTimeUnixNano: nano(120_500),
      statusCode: 2,
    }),
  ];

  beforeAll(async () => {
    await startTestContainers();
    client = getTestClickHouseClient()!;
    tenantId = generateTestTenantId();
    traceA = generateTestAggregateId("rollup-replay-a");
    traceB = generateTestAggregateId("rollup-replay-b");

    const records = buildEvents().map((event) => ({
      TenantId: tenantId,
      AggregateType: "trace",
      AggregateId: event.aggregateId,
      EventId: event.id,
      EventType: SPAN_RECEIVED_EVENT_TYPE,
      EventTimestamp: event.occurredAt,
      EventOccurredAt: event.occurredAt,
      EventVersion: "2025-12-14",
      // Production stores only the event's DATA here (eventStoreUtils
      // .eventToRecord); the replay loader rebuilds the envelope from the
      // row's own columns and parses this straight into `event.data`.
      EventPayload: JSON.stringify(event.data),
      IdempotencyKey: event.id,
      // Never-expire sentinel so the table TTL cannot reap the fixture.
      _retention_days: 0,
    }));

    await client.insert({
      table: "event_log",
      values: records,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
    });
  });

  afterAll(async () => {
    await cleanupTenantData(client, tenantId);
    await stopTestContainers();
  });

  describe("when the traceAnalyticsRollup projection is replayed through the real replay path", () => {
    it("reconstructs the rollup rows the live projection would have written", async () => {
      const redis = getTestRedisConnection()!;
      // A completed-set entry from an earlier run must not skip this one.
      await cleanupAll({ redis, projectionName: PROJECTION_NAME });

      const projection = new TraceAnalyticsRollupMapProjection({
        store: new TraceAnalyticsRollupAppendStore(
          new TraceAnalyticsRollupClickHouseRepository(async () => client),
        ),
      });
      const registered: RegisteredMapProjection = {
        projectionName: PROJECTION_NAME,
        pipelineName: "trace-processing",
        aggregateType: "trace",
        source: "pipeline",
        definition: projection,
        pauseKey: `trace-processing/handler/${PROJECTION_NAME}`,
        kind: "map",
        targetTable: "trace_analytics_rollup",
      };

      const result = await runFoldMapReplay({
        ctx: {
          redis,
          resolveClient: async () => client,
          accumulatorOpts: {},
        },
        config: {
          projections: [],
          mapProjections: [registered],
          tenantIds: [tenantId],
          since: new Date(0).toISOString(),
          batchSize: 100,
          aggregateBatchSize: 10,
        },
        callbacks: { log: nullLog },
      });

      expect(result.firstError).toBeUndefined();
      expect(result.batchErrors).toBe(0);
      expect(result.aggregatesReplayed).toBe(2);
      expect(result.totalEvents).toBe(3);

      const rows = await readRollupTotals(client, tenantId);

      // Literal expectations: the root of trace A keys on the RESPONSE model
      // and its span type, carries the trace count and wall-clock duration and
      // the token sums; the child contributes one span to the ('', '') bucket
      // of the same minute; the ERROR root of trace B lands in the next minute
      // bucket with its error count.
      expect(rows).toEqual([
        {
          bucketMs: ms(0),
          model: "",
          spanType: "",
          spanCount: 1,
          traceCount: 0,
          errorCount: 0,
          durationSum: 0,
          promptTokens: 0,
          completionTokens: 0,
        },
        {
          bucketMs: ms(0),
          model: "gpt-4o-2024-08-06",
          spanType: "llm",
          spanCount: 1,
          traceCount: 1,
          errorCount: 0,
          durationSum: 1_500,
          promptTokens: 100,
          completionTokens: 20,
        },
        {
          bucketMs: ms(120_000),
          model: "",
          spanType: "",
          spanCount: 1,
          traceCount: 1,
          errorCount: 1,
          durationSum: 500,
          promptTokens: 0,
          completionTokens: 0,
        },
      ]);

      // Parity with the projection's direct output: replay must feed the map
      // handler the same events live dispatch would, so summing the rows the
      // projection emits for the same fixture reproduces the table exactly.
      const direct = buildEvents().map((event) =>
        projection.mapTraceSpanReceived(event),
      );
      expect(additiveTotals(rows)).toEqual(additiveTotals(direct));
    });
  });
});
