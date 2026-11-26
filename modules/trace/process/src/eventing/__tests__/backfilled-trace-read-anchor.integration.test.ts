/**
 * @vitest-environment node
 * @integration
 * Spec: specs/trace-processing/backfilled-trace-read-anchor.feature
 * A trace whose spans started nine days before they arrive, folded through the real executor and
 * ClickHouse stores with no Redis tier (every read reaches the table), then its origin resolved.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  createTenantId,
  FoldProjectionExecutor,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import {
  RESOLVE_ORIGIN_COMMAND_TYPE,
  type ResolveOriginCommandData,
} from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProofAuthorizer } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { authorizedClickHouseFor } from "../../repositories/clickhouse/__tests__/support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { TraceAnalyticsClickHouseRepository } from "../../repositories/clickhouse/trace-metrics-analytics.repository.ts";
import { TraceSummaryProjectionClickHouseRepository } from "../../repositories/clickhouse/trace-summary.repository.ts";
import { createDeferredOriginHandler } from "../deferred-origin.subscriber.ts";
import { TraceAnalyticsFoldProjection } from "../trace-derived.projection.ts";
import { TraceAnalyticsStore } from "../trace-derived.store.ts";
import { EventingTraceOriginAdapter } from "../trace-origin.commands.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import { TraceSummaryStore } from "../trace-summary.store.ts";
import { memoryEvaluationAnalytics } from "./trace-evaluation-analytics.fixtures.ts";
import {
  createSpanReceivedEvent,
  createTestRuntime,
  msToUnixNano,
} from "./trace-summary-test.fixtures.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-backfill-anchor-${nanoid()}`;
const NOW = Date.now();
const SPAN_START_MS = NOW - 9 * DAY_MS;

let ch: ClickHouseClient;
let summaryStore: TraceSummaryStore;
let summaryFold: TraceSummaryFoldProjection;
let analyticsFold: TraceAnalyticsFoldProjection;
const executor = new FoldProjectionExecutor();

/** The stores' writes are async inserts; reads must see them. */
async function flushWrites(): Promise<void> {
  await ch.command({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
}

function contextFor(traceId: string): ProjectionStoreContext {
  return { aggregateId: traceId, tenantId: createTenantId(tenantId), key: traceId };
}

async function foldBoth(traceId: string, events: readonly unknown[]): Promise<void> {
  await executor.executeBatch(summaryFold as never, events as never, contextFor(traceId));
  await executor.executeBatch(analyticsFold as never, events as never, contextFor(traceId));
  await flushWrites();
}

/** One span arriving now; by default it started nine days ago (a backfill). */
async function arrive({
  traceId,
  spanId,
  startMs = SPAN_START_MS,
}: {
  traceId: string;
  spanId: string;
  startMs?: number;
}): Promise<void> {
  const span = createSpanReceivedEvent({
    eventId: `evt-${traceId}-${spanId}`,
    tenantId,
    traceId,
    spanId,
    occurredAt: Date.now(),
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(startMs + 500),
  });
  await foldBoth(traceId, [span]);
}

/** The deferred check as the runtime runs it: summary found, then the origin resolved. */
async function resolveDeferredOrigin(traceId: string): Promise<void> {
  const read = await summaryStore.get(traceId, contextFor(traceId));
  const summary = read.kind === "folded" ? read.state : null;
  const handler = createDeferredOriginHandler(async (data: ResolveOriginCommandData) => {
    const events = EventingTraceOriginAdapter.create().handle({
      type: RESOLVE_ORIGIN_COMMAND_TYPE,
      tenantId,
      aggregateId: traceId,
      data,
    } as never);
    await foldBoth(traceId, events);
  });
  await handler({
    id: traceId,
    tenantId,
    traceId,
    ...(summary?.storageAnchorMs ? { traceAnchorMs: summary.storageAnchorMs } : {}),
  });
}

/** The span half of the slim dashboards' has-signal predicate: an empty row is not a trace. */
const HAS_SIGNAL_SQL = "(SpanCount > 0 OR EarliestSpanStartMs > 0)";

const latestRowSchema = (rows: unknown) =>
  rows as { latestSpanCount: number; latestHasSignal: number; latestOrigin: string }[];

/** The newest trace_analytics version per trace, the way the slim dashboards pick it. */
async function latestAnalyticsRow(traceId: string) {
  const result = await ch.query({
    query: `
      SELECT argMax(SpanCount, UpdatedAt) AS latestSpanCount,
             toUInt8(argMax(${HAS_SIGNAL_SQL}, UpdatedAt)) AS latestHasSignal,
             argMax(Origin, UpdatedAt) AS latestOrigin
      FROM trace_analytics
      WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
      GROUP BY TraceId
    `,
    query_params: { tenantId, traceId },
    format: "JSONEachRow",
  });
  return latestRowSchema(await result.json())[0];
}

/** Traces a 30-day slim timeseries counts: newest version per trace, with a signal. */
async function tracesCountedInLast30Days(): Promise<string[]> {
  const result = await ch.query({
    query: `
      SELECT TraceId
      FROM trace_analytics
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= fromUnixTimestamp64Milli({from:Int64})
      GROUP BY TraceId
      HAVING argMax(${HAS_SIGNAL_SQL}, UpdatedAt) = 1
    `,
    query_params: { tenantId, from: NOW - 30 * DAY_MS },
    format: "JSONEachRow",
  });
  return ((await result.json()) as { TraceId: string }[]).map((row) => row.TraceId);
}

beforeAll(async () => {
  if (!testClickHouseConfigured()) return;
  ch = await startMigratedTraceClickHouse();
  summaryStore = TraceSummaryStore.create({
    storage: TraceSummaryProjectionClickHouseRepository.create({
      resolveClient: async () => ch,
      clickhouse: authorizedClickHouseFor(ch),
    }),
    defaultRetentionDays: () => 0,
    authorize: ownProofAuthorizer,
  });
  summaryFold = TraceSummaryFoldProjection.create({
    store: summaryStore,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime: createTestRuntime(),
  });
  analyticsFold = TraceAnalyticsFoldProjection.create({
    store: TraceAnalyticsStore.create({
      storage: TraceAnalyticsClickHouseRepository.create({
        resolveClient: async () => ch,
        clickhouse: authorizedClickHouseFor(ch),
      }),
      evaluationAnalytics: memoryEvaluationAnalytics(),
      defaultRetentionDays: () => 0,
      authorize: ownProofAuthorizer,
    }),
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime: createTestRuntime(),
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const table of ["trace_summaries", "trace_analytics"]) {
    await ch.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await ch.close();
});

describe.skipIf(!testClickHouseConfigured())("a backfilled trace (integration)", () => {
  /** @scenario "A backfilled trace keeps its spans in trace analytics after its origin resolves" */
  it("keeps both spans and gains its origin, and still counts in a 30-day timeseries", async () => {
    const traceId = `trace-backfill-${nanoid()}`;
    await arrive({ traceId, spanId: "bbbb000000000001" });
    await arrive({ traceId, spanId: "bbbb000000000002" });

    await resolveDeferredOrigin(traceId);

    expect(await latestAnalyticsRow(traceId)).toEqual({
      latestSpanCount: 2,
      latestHasSignal: 1,
      latestOrigin: "application",
    });
    expect(await tracesCountedInLast30Days()).toContain(traceId);
    const summary = await summaryStore.get(traceId, contextFor(traceId));
    expect(summary.kind === "folded" ? summary.state.spanCount : 0).toBe(2);
    expect(summary.kind === "folded" ? summary.state.attributes["langwatch.origin"] : null).toBe(
      "application",
    );
  });

  /** @scenario "A live trace keeps its state when a span that started long before arrives" */
  it("keeps a live trace's first span when a span that started nine days earlier arrives", async () => {
    const traceId = `trace-live-${nanoid()}`;
    await arrive({ traceId, spanId: "bbbb000000000001", startMs: Date.now() });
    await arrive({ traceId, spanId: "bbbb000000000002", startMs: SPAN_START_MS });

    expect((await latestAnalyticsRow(traceId))?.latestSpanCount).toBe(2);
    const summary = await summaryStore.get(traceId, contextFor(traceId));
    expect(summary.kind === "folded" ? summary.state.spanCount : 0).toBe(2);
  });
});
