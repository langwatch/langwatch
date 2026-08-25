/**
 * Integration test for the ops full-rebuild replay path.
 *
 * A replay that is cancelled or fails leaves its completed markers in Redis on
 * purpose, so a plain re-run resumes instead of repeating work. When the target
 * table has meanwhile been emptied (migrations 00065/00066 swap the analytics
 * rollups to Replicated engines and come out empty on clustered deployments),
 * that same behaviour makes the rebuild report success while silently skipping
 * every aggregate the earlier run had finished. `fullRebuild` clears those
 * markers under the replay lock, before discovery, so the rebuild covers them.
 *
 * Everything below the ops entry point is real: the Redis-backed replay
 * repository (lock, status, history), the event-sourcing replay service and its
 * optimized path, the real `traceAnalyticsRollup` projection and its ClickHouse
 * append store. Only `createReplayRuntime` is substituted, because the
 * production factory resolves ClickHouse through the app registry; the runtime
 * it returns here is built from the same real classes.
 *
 * BDD structure: describe("given X") → describe("when Y") → it("…").
 */

import type { ClickHouseClient } from "@clickhouse/client";
import type { RegisteredMapProjection } from "@langwatch/eventing";
import {
  aggregateKey,
  cleanupAll,
  ReplayService as EventSourcingReplayService,
  getCompletedSet,
  unmarkBatch,
} from "@langwatch/eventing";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceAnalyticsRollupClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-analytics-rollup.clickhouse.repository";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  generateTestAggregateId,
  generateTestTenantId,
} from "~/server/event-sourcing/__tests__/integration/testHelpers";
import { createSpanReceivedEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/__tests__/fixtures/trace-summary-test.fixtures";
import { TraceAnalyticsRollupMapProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalyticsRollup.mapProjection";
import { TraceAnalyticsRollupAppendStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalyticsRollup.store";
import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { ClickHouseReplayEventSource } from "~/server/event-sourcing/replay/replayEventLoader";
import { createReplayRuntime } from "~/server/event-sourcing/replay/replayPreset";
import { ReplayService } from "../../replay.service";
import { ReplayRedisRepository } from "../../repositories/replay.redis.repository";

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

vi.mock("~/server/event-sourcing/replay/replayPreset", () => ({
  createReplayRuntime: vi.fn(),
}));

const mockedCreateReplayRuntime = vi.mocked(createReplayRuntime);

const PROJECTION_NAME = "traceAnalyticsRollup";
const AGGREGATE_TYPE = "trace";
const SINCE = new Date(0).toISOString();

/** Minute-aligned base a day in the past, inside every retention window. */
const baseMs = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 60_000) * 60_000;
const nano = (offset: number) => `${baseMs + offset}000000`;

let client: ClickHouseClient;
let redis: Redis;
let opsReplay: ReplayService;

/** No surviving marker, default run: pins that the fixture replays at all. */
let witnessTenantId: string;
let witnessTraceId: string;
/** Surviving marker, default run: the silent skip. */
let skippedTenantId: string;
let skippedTraceId: string;
/** Surviving marker, fullRebuild run: the fix. */
let rebuiltTenantId: string;
let rebuiltTraceId: string;

/**
 * Two spans on one trace: an LLM root carrying the trace and its tokens, and a
 * child that only adds a span count. Enough shape for the rollup to be visibly
 * present or visibly absent.
 */
function buildEvents(tenantId: string, traceId: string) {
  return [
    createSpanReceivedEvent({
      eventId: `evt-${traceId}-root`,
      tenantId,
      traceId,
      spanId: "aaaa000000000001",
      parentSpanId: null,
      occurredAt: baseMs,
      startTimeUnixNano: nano(0),
      endTimeUnixNano: nano(1_500),
      attributes: {
        "gen_ai.response.model": "gpt-4o-2024-08-06",
        "langwatch.span.type": "llm",
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 20,
      },
    }),
    createSpanReceivedEvent({
      eventId: `evt-${traceId}-child`,
      tenantId,
      traceId,
      spanId: "aaaa000000000002",
      parentSpanId: "aaaa000000000001",
      occurredAt: baseMs + 1_000,
      startTimeUnixNano: nano(10_000),
      endTimeUnixNano: nano(11_000),
    }),
  ];
}

async function seedEventLog(tenantId: string, traceId: string): Promise<void> {
  const records = buildEvents(tenantId, traceId).map((event) => ({
    TenantId: tenantId,
    AggregateType: AGGREGATE_TYPE,
    AggregateId: event.aggregateId,
    EventId: event.id,
    EventType: SPAN_RECEIVED_EVENT_TYPE,
    EventTimestamp: event.occurredAt,
    EventOccurredAt: event.occurredAt,
    EventVersion: "2025-12-14",
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
}

/**
 * Leave behind exactly what an aborted run leaves: the aggregate recorded in
 * the projection's completed set, written by the same helper the replay uses.
 */
async function seedCompletedMarker(tenantId: string, traceId: string): Promise<void> {
  await unmarkBatch({
    redis,
    projectionName: PROJECTION_NAME,
    aggKeys: [
      aggregateKey({
        tenantId,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: traceId,
      }),
    ],
  });
}

async function readRollupTotals(
  tenantId: string,
): Promise<{ spanCount: number; traceCount: number; rowCount: number }> {
  const result = await client.query({
    query: `
      SELECT
        sum(SpanCount) AS spanCount,
        sum(TraceCount) AS traceCount,
        count() AS rowCount
      FROM trace_analytics_rollup
      WHERE TenantId = {tenantId:String}
    `,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{
    spanCount: string;
    traceCount: string;
    rowCount: string;
  }>();
  const row = rows[0];
  return {
    spanCount: Number(row?.spanCount ?? 0),
    traceCount: Number(row?.traceCount ?? 0),
    rowCount: Number(row?.rowCount ?? 0),
  };
}

/** Start a run through the ops entry point and wait for it to leave "running". */
async function startAndAwaitReplay(params: {
  tenantIds: string[];
  fullRebuild?: boolean;
}) {
  const { runId } = await opsReplay.startReplay({
    projectionNames: [PROJECTION_NAME],
    since: SINCE,
    tenantIds: params.tenantIds,
    fullRebuild: params.fullRebuild,
    description: "rebuild analytics rollup after the Replicated-engine swap",
    userName: "integration-test",
  });

  // Throwing rather than asserting: vi.waitFor retries on a throw, and the
  // run's outcome is asserted in the test that started it.
  await vi.waitFor(
    async () => {
      const status = await opsReplay.getStatus();
      if (status.runId !== runId || status.state === "running") {
        throw new Error(
          `run ${runId} has not finished (status ${status.state} for ${status.runId})`,
        );
      }
    },
    { timeout: 30_000, interval: 100 },
  );

  return opsReplay.getStatus();
}

describe("given identical span history for tenants whose rollup is empty", () => {
  beforeAll(async () => {
    await startTestContainers();
    client = getTestClickHouseClient()!;
    redis = getTestRedisConnection()!;

    witnessTenantId = generateTestTenantId();
    witnessTraceId = generateTestAggregateId("rebuild-witness");
    skippedTenantId = generateTestTenantId();
    skippedTraceId = generateTestAggregateId("rebuild-skipped");
    rebuiltTenantId = generateTestTenantId();
    rebuiltTraceId = generateTestAggregateId("rebuild-full");

    // Identical fixtures per tenant, so the marker and the flag are the only
    // variables between the three runs below.
    await seedEventLog(witnessTenantId, witnessTraceId);
    await seedEventLog(skippedTenantId, skippedTraceId);
    await seedEventLog(rebuiltTenantId, rebuiltTraceId);

    const projection = new TraceAnalyticsRollupMapProjection({
      store: new TraceAnalyticsRollupAppendStore(
        new TraceAnalyticsRollupClickHouseRepository(async () => client),
      ),
    });
    const registered: RegisteredMapProjection = {
      projectionName: PROJECTION_NAME,
      pipelineName: "trace-processing",
      aggregateType: AGGREGATE_TYPE,
      source: "pipeline",
      definition: projection,
      pauseKey: `trace-processing/handler/${PROJECTION_NAME}`,
      kind: "map",
      targetTable: "trace_analytics_rollup",
    };

    mockedCreateReplayRuntime.mockReturnValue({
      projections: [],
      mapProjections: [registered],
      stateProjections: [],
      service: new EventSourcingReplayService({
        eventSource: new ClickHouseReplayEventSource(async () => client),
        redis,
      }),
      // The connection is shared with the suite, so closing is the harness's job.
      close: async () => {},
    });

    opsReplay = new ReplayService(new ReplayRedisRepository(redis));
  });

  beforeEach(async () => {
    const keys = await redis.keys("ops:replay:*");
    if (keys.length > 0) await redis.del(...keys);
    await cleanupAll({ redis, projectionName: PROJECTION_NAME });
  });

  afterAll(async () => {
    await cleanupAll({ redis, projectionName: PROJECTION_NAME });
    for (const tenantId of [witnessTenantId, skippedTenantId, rebuiltTenantId]) {
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
    await stopTestContainers();
  });

  describe("when a default replay runs for an aggregate with no marker", () => {
    it("rebuilds the rollup rows, so the fixture is replayable", async () => {
      const status = await startAndAwaitReplay({
        tenantIds: [witnessTenantId],
      });

      expect(status.state).toBe("completed");
      expect(status.error).toBeNull();

      const totals = await readRollupTotals(witnessTenantId);
      expect(totals.spanCount).toBe(2);
      expect(totals.traceCount).toBe(1);
    });
  });

  describe("when a default replay runs for the marked aggregate", () => {
    it("reports a successful run that wrote nothing", async () => {
      await seedCompletedMarker(skippedTenantId, skippedTraceId);

      const status = await startAndAwaitReplay({
        tenantIds: [skippedTenantId],
      });

      expect(status.state).toBe("completed");
      expect(status.error).toBeNull();
      expect(await readRollupTotals(skippedTenantId)).toEqual({
        spanCount: 0,
        traceCount: 0,
        rowCount: 0,
      });
    });
  });

  describe("when a full rebuild runs for the marked aggregate", () => {
    /** @scenario A full rebuild replays aggregates an interrupted run had completed */
    it("clears the marker and rebuilds the rollup rows", async () => {
      await seedCompletedMarker(rebuiltTenantId, rebuiltTraceId);

      const status = await startAndAwaitReplay({
        tenantIds: [rebuiltTenantId],
        fullRebuild: true,
      });

      expect(status.state).toBe("completed");
      expect(status.error).toBeNull();

      const totals = await readRollupTotals(rebuiltTenantId);
      expect(totals.spanCount).toBe(2);
      expect(totals.traceCount).toBe(1);

      // The run owns the markers end to end: cleared before discovery, and
      // cleared again by the replay path once every batch completed.
      expect(await getCompletedSet({ redis, projectionName: PROJECTION_NAME })).toEqual(
        new Set(),
      );
    });
  });
});
