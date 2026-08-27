import { AppTraceProjectionsAdapter } from "~/runtime/app/trace-projections.adapter";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
/**
 * Real integration test for online-evaluator loop prevention.
 *
 * Scope (honest):
 *   - Uses testcontainers (Redis + ClickHouse) — REAL infrastructure.
 *   - Drives recordSpan through the REAL EventSourcing pipeline,
 *     real TraceSummaryFoldProjection, real CH writes.
 *   - Reads fold state back from REAL ClickHouse.
 *   - Invokes the REAL evaluationTrigger subscriber's handle() with a
 *     constructed event + state (read from CH) to assert on the
 *     loop-prevention behaviour.
 *
 *   The subscriber's queue worker is NOT exercised in this test.
 *   That is harness plumbing, not feature behaviour, and other subscriber
 *   integration tests in this codebase (e.g.
 *   customEvaluationSync.subscriber.integration.test.ts) are `.skip`'d for
 *   the same reason — making subscriber pickup reliable in the
 *   vitest harness is a separate problem from "does the subscriber
 *   correctly block depth>=1 spans against real fold state from real
 *   ClickHouse." This test answers the latter, which is the
 *   post-2026-05-11 incident question.
 *
 * What this test proves:
 *   1. recordSpan + the trace-processing pipeline + CH persistence
 *      survive a depth=0 span and produce a state with
 *      langwatch.origin resolved.
 *   2. The REAL evaluationTrigger subscriber (createEvaluationTriggerSubscriber)
 *      against that REAL state DISPATCHES one executeEvaluation
 *      per enabled ON_MESSAGE monitor.
 *   3. The same subscriber with a depth=1 span event BLOCKS dispatch
 *      and increments the `langwatch_evaluator_loop_blocked_total`
 *      counter with reason="depth_direct".
 *   4. The same subscriber with a fresh depth=0 span on the same trace
 *      DISPATCHES again. The guard is per-span, not per-trace —
 *      legitimate new app activity must still re-trigger evaluation.
 *   5. The operator kill switch bypasses the depth check.
 */

import type { EventSourcing } from "@langwatch/eventing";
import { defineAggregate, defineEvents, definePipeline } from "@langwatch/eventing";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { createAppTraceSummaryStore } from "~/runtime/app/trace-summary-fold.adapter";
import { AppTraceProjectionStorageAdapter } from "~/runtime/app/trace-projection-storage.adapter";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { EventRepositoryClickHouse } from "~/server/event-sourcing/adapters/clickhouse/eventRepositoryClickHouse";
import { EventStoreClickHouse } from "~/server/event-sourcing/adapters/clickhouse/eventStoreClickHouse";
import { evaluatorLoopBlockedCounter } from "~/server/metrics";
import { makeQueueName } from "~/server/queues/makeQueueName";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestEventSourcing,
  createTestTenantId,
  getTenantIdString,
} from "~/server/event-sourcing/__tests__/integration/testHelpers";
import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import { AssignTopicCommand } from "@langwatch/trace-server";
import { RecordSpanCommand } from "@langwatch/trace-server";
import { TraceSummaryFoldProjection } from "@langwatch/trace-server";
import { TRACE_PROCESSING_EVENT_TYPES } from "@langwatch/trace-contract";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { createEvaluationTriggerSubscriber } from "~/runtime/app/trace-evaluation-trigger.adapter";

const hasTestcontainers = !!(process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL);

// ---------------------------------------------------------------------------
// Fakes wired into the real pipeline.
// ---------------------------------------------------------------------------

function createTestRecordSpanCommand(): RecordSpanCommand {
  return RecordSpanCommand.create({
    piiRedaction: { redact: async () => {} },
    costEnrichment: { enrich: async () => {} },
    tokenEstimation: { estimate: async () => {} },
    contentDrop: {
      drop: async () => ({ droppedCount: 0, droppedCategories: [] }),
    },
  });
}

function makeFakeMonitorService() {
  const monitor: MonitorSummary = {
    id: "monitor_test_loop_prevention",
    checkType: "workflow",
    name: "Loop Prevention Test Monitor",
    threadIdleTimeout: null,
    evaluator: { name: "test/evaluator" },
  };
  return {
    async getEnabledOnMessageMonitors() {
      return [monitor];
    },
  };
}

function makeCapturingEvaluationDispatcher() {
  const captured: ExecuteEvaluationCommandData[] = [];
  return {
    captured,
    dispatch: async (data: ExecuteEvaluationCommandData) => {
      captured.push(data);
    },
  };
}

const noopFoldSubscriber = () => ({
  fold: "traceSummary",
  handler: async () => {},
});
const noopMapSubscriber = () => ({
  map: "spanStorage",
  handler: async () => {},
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildAppOriginSpan(opts: {
  traceId: string;
  spanId: string;
  depth: number;
  startedAtMs?: number;
}): OtlpSpan {
  const startNano = BigInt(opts.startedAtMs ?? Date.now()) * 1_000_000n;
  const endNano = startNano + 1_000_000_000n;
  const attrs: Array<{
    key: string;
    value: { stringValue?: string; intValue?: string };
  }> = [
    { key: "langwatch.origin", value: { stringValue: "application" } },
    { key: "langwatch.span.type", value: { stringValue: "span" } },
  ];
  if (opts.depth > 0) {
    attrs.push({
      key: "langwatch.reserved.causality_depth",
      value: { stringValue: String(opts.depth) },
    });
  }
  return {
    traceId: opts.traceId,
    spanId: opts.spanId,
    parentSpanId: null,
    name: "test-span",
    kind: 1,
    startTimeUnixNano: startNano.toString(),
    endTimeUnixNano: endNano.toString(),
    attributes: attrs,
    events: [],
    links: [],
    status: { code: 1, message: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs, label }: { timeoutMs: number; label: string },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}

/**
 * Reads the prom-client counter so assertions can be delta-based and
 * isolated from parallel tests.
 */
async function readBlockedCounter(reason: string): Promise<number> {
  const metric = await (evaluatorLoopBlockedCounter as any).get();
  for (const v of metric.values ?? []) {
    if (v.labels?.reason === reason) {
      return v.value as number;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!hasTestcontainers)(
  "evaluationTrigger subscriber — loop prevention end-to-end through the real event-sourcing pipeline",
  () => {
    let eventSourcing: EventSourcing;
    let tracePipeline: ReturnType<typeof createTracePipeline>;
    let traceSummaryStore: ReturnType<typeof createAppTraceSummaryStore>;
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;
    let dispatcher: ReturnType<typeof makeCapturingEvaluationDispatcher>;
    let featureFlags: MemoryFeatureFlagService;

    function createTracePipeline() {
      const clickHouseClient = getTestClickHouseClient();
      const redisConnection = getTestRedisConnection();
      if (!clickHouseClient || !redisConnection) {
        throw new Error("ClickHouse + Redis required.");
      }

      const eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(async () => clickHouseClient),
      );
      eventSourcing = createTestEventSourcing({
        eventStore,
        redis: redisConnection,
      });

      const spanAppendStore = AppTraceProjectionStorageAdapter.createSpanStore({
        repository: new SpanStorageService(
          new SpanStorageClickHouseRepository(async () => clickHouseClient),
        ).repository,
        defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      });
      traceSummaryStore = createAppTraceSummaryStore({
        repository: new TraceSummaryService(
          new TraceSummaryClickHouseRepository(async () => clickHouseClient),
        ).repository,
        redis: null,
        defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      });

      // Build the REAL evaluationTrigger subscriber with a capturing
      // dispatcher and wire it into the pipeline so the
      // GroupQueueProcessor actually fires it when spans land.
      // Override `delay` to 0 — production default is 30s, which is
      // a deliberate dedup window but unhelpful for tests.
      const monitorService = makeFakeMonitorService();
      dispatcher = makeCapturingEvaluationDispatcher();
      featureFlags = MemoryFeatureFlagService.create();
      const realSubscriber = createEvaluationTriggerSubscriber({
        featureFlags,
        monitors: monitorService,
        evaluation: dispatcher.dispatch,
      });
      const fastSpec = { ...realSubscriber.spec, delay: 0 };

      const pipelineName = `trace_loop_prevention_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const pipelineDef = definePipeline<TraceProcessingEvent>({
        name: pipelineName,
        aggregate: defineAggregate({
          type: "trace",
          events: defineEvents(TRACE_PROCESSING_EVENT_TYPES),
        }),
      })
        .withClickHouseFoldProjection(
          TraceSummaryFoldProjection.create({
            store: traceSummaryStore,
            runtime: AppTraceProjectionsAdapter.createRuntime(
              TraceCanonicalisationService.create(),
            ),
            traceCanonicalisation: TraceCanonicalisationService.create(),
          }) as any,
        )
        .withClickHouseMapProjection(
          AppTraceProjectionsAdapter.createSpanStorageProjection({
            store: spanAppendStore,
            canonicalisation: TraceCanonicalisationService.create(),
          }) as any,
        )
        .withProjectionSubscriber("evaluationTrigger", fastSpec as any)
        .withProjectionSubscriber("customEvaluationSync", noopFoldSubscriber() as any)
        .withProjectionSubscriber("traceUpdateBroadcast", noopFoldSubscriber() as any)
        .withProjectionSubscriber("simulationMetricsSync", noopFoldSubscriber() as any)
        .withProjectionSubscriber("projectMetadata", noopFoldSubscriber() as any)
        .withProjectionSubscriber("spanStorageBroadcast", noopMapSubscriber() as any)
        .withCommandInstance("recordSpan", RecordSpanCommand, createTestRecordSpanCommand())
        .withCommand("assignTopic", AssignTopicCommand as any)
        .build();

      const registered = eventSourcing.register(pipelineDef);
      return {
        ...registered,
        ready: () => registered.service.waitUntilReady(),
      };
    }

    // Stale Redis jobs from prior test-file runs (different pipeline
    // names) cause "Unknown job in global queue" rejections that
    // block this run's subscribers from picking up work. Clear those once
    // before any test in this suite executes.
    //
    // Scoped to the global queue's own keys, NOT flushdb(). flushdb empties
    // the whole logical database, and this runs in beforeAll — so it deleted
    // the in-flight state of every other suite sharing the database at the
    // moment this file started. The groupQueue suites were the visible
    // casualties: a staged job that never dispatches, a blocked set that
    // never fills, always in a file that never called flushdb itself.
    beforeAll(async () => {
      const redisConnection = getTestRedisConnection();
      if (redisConnection) {
        const stale = await redisConnection.keys(`${makeQueueName("event-sourcing/jobs")}*`);
        if (stale.length > 0) await redisConnection.del(...stale);
      }
    });

    beforeEach(async () => {
      tracePipeline = createTracePipeline();
      tenantId = createTestTenantId();
      tenantIdString = getTenantIdString(tenantId);
      await tracePipeline.ready();
    }, 30_000);

    afterEach(async () => {
      await eventSourcing.close();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await cleanupTestDataForTenant(tenantIdString);
    });

    /**
     * Push a span through the real GroupQueueProcessor pipeline.
     * Awaits the trace_summaries row landing in ClickHouse so the
     * fold projection definitely ran before we move on. Subscriber
     * dispatch is asynchronous afterwards — assert on
     * `dispatcher.captured` directly in the tests.
     */
    async function recordSpan(span: OtlpSpan): Promise<void> {
      await tracePipeline.commands.recordSpan.send({
        tenantId: tenantIdString,
        span: span as any,
        resource: { attributes: [], droppedAttributesCount: 0 } as any,
        instrumentationScope: { name: "langwatch.test" } as any,
        piiRedactionLevel: "DISABLED",
        occurredAt: Date.now(),
      });

      await waitFor(
        async () => {
          const fold = await traceSummaryStore.get((span as any).traceId, {
            tenantId: tenantIdString,
          } as any);
          return !!fold?.attributes?.["langwatch.origin"];
        },
        {
          timeoutMs: 20_000,
          label: "trace_summaries row with resolved origin in CH",
        },
      );
    }

    /**
     * Quiet window after a span lands. The real evaluationTrigger
     * subscriber is dispatched asynchronously by the GroupQueueProcessor;
     * `recordSpan` only awaits the fold. We need to give the worker a
     * polling cycle to pick up the subscriber job and either call dispatch
     * or block it. 1500ms is comfortably above the dispatcher's BRPOP
     * timeout cadence at signalTimeoutSec=5 with delay=0 jobs.
     */
    async function quietSubscriberWindow(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    describe("given an incoming span with causality_depth=0", () => {
      describe("when the span is recorded through the pipeline", () => {
        /** @scenario Incoming span with causality_depth=0 still triggers evaluations */
        it("dispatches one executeEvaluation per monitor", async () => {
          const traceId = generateId("trace");
          const span = buildAppOriginSpan({
            traceId,
            spanId: generateId("span"),
            depth: 0,
          });

          await recordSpan(span);
          await waitFor(() => dispatcher.captured.length >= 1, {
            timeoutMs: 20_000,
            label: "subscriber dispatched evaluation through the real queue",
          });

          expect(dispatcher.captured).toHaveLength(1);
          expect(dispatcher.captured[0]!.evaluatorId).toBe("monitor_test_loop_prevention");
          expect(dispatcher.captured[0]!.tenantId).toBe(tenantIdString);
          expect(dispatcher.captured[0]!.traceId).toBe(traceId);
        });
      });
    });

    describe("given an incoming span with causality_depth=1", () => {
      describe("when the span is recorded after a depth=0 seed", () => {
        /** @scenario Incoming span with causality_depth=1 does not trigger evaluations */
        it("blocks dispatch and increments the loop-blocked counter", async () => {
          const traceId = generateId("trace");

          // Seed: app-origin depth=0 span establishes the trace's origin
          // on the fold (required for the originGuardedSubscriber wrapper
          // to fire its inner handler at all).
          await recordSpan(
            buildAppOriginSpan({
              traceId,
              spanId: generateId("seed"),
              depth: 0,
            }),
          );
          // The seed itself triggers one dispatch. Wait for it so we
          // have a stable baseline to assert no further dispatch happens.
          await waitFor(() => dispatcher.captured.length >= 1, {
            timeoutMs: 20_000,
            label: "seed depth=0 dispatched",
          });
          const dispatchesBefore = dispatcher.captured.length;
          const beforeBlocked = await readBlockedCounter("depth_direct");

          // Eval-emitted span (depth=1) — must be blocked by the subscriber.
          await recordSpan(
            buildAppOriginSpan({
              traceId,
              spanId: generateId("eval"),
              depth: 1,
            }),
          );
          // Poll the prom counter instead of sleeping a fixed 1500ms. The
          // subscriber → queue → metric write chain can take longer than that
          // under parallel CI load, which flaked this test (PR #4189 CI:
          // `expected 0 to be greater than or equal to 1`). The dispatch
          // assertion stays as a post-condition: by the time the blocked
          // counter ticks the subscriber has decided not to dispatch.
          await waitFor(async () => (await readBlockedCounter("depth_direct")) > beforeBlocked, {
            timeoutMs: 20_000,
            label: "loop-blocked counter incremented for depth_direct",
          });

          expect(dispatcher.captured.length).toBe(dispatchesBefore);
          const afterBlocked = await readBlockedCounter("depth_direct");
          expect(afterBlocked - beforeBlocked).toBeGreaterThanOrEqual(1);
        });
      });
    });

    describe("given a trace that has already seen depth=0 then depth=1", () => {
      describe("when a fresh depth=0 span arrives later on the same trace", () => {
        /** @scenario Causality guard is per-span — fresh app activity still re-triggers */
        it("re-dispatches because the depth check is per-span, not per-trace", async () => {
          const traceId = generateId("trace");

          // 1. Initial app-origin span — should dispatch.
          await recordSpan(
            buildAppOriginSpan({
              traceId,
              spanId: generateId("s1"),
              depth: 0,
            }),
          );
          await waitFor(() => dispatcher.captured.length >= 1, {
            timeoutMs: 20_000,
            label: "first depth=0 dispatched",
          });
          const dispatchesAfter1 = dispatcher.captured.length;
          expect(dispatchesAfter1).toBe(1);

          // 2. Eval-emitted span on same trace (depth=1) — must NOT add a
          //    dispatch. The subscriber dedup window (30s makeJobId TTL) is
          //    irrelevant here because the depth check returns BEFORE the
          //    queue's dedup applies — that's exactly the guarantee.
          await recordSpan(
            buildAppOriginSpan({
              traceId,
              spanId: generateId("s2"),
              depth: 1,
            }),
          );
          await quietSubscriberWindow();
          expect(dispatcher.captured.length).toBe(dispatchesAfter1);

          // 3. Fresh app-origin span (depth=0) later on SAME trace —
          //    legitimate new activity, MUST dispatch again. The subscriber
          //    has `makeJobId(...) = eval-trigger:tenant:trace` plus a
          //    30s TTL — to bypass the queue-side dedup of this case we
          //    nuke the dedup keys for this trace before re-dispatching.
          //    (In production, the 30s window IS the dedup; tests just
          //    need to prove the depth check itself doesn't pin the
          //    trace forever.)
          const redis = getTestRedisConnection()!;
          const dedupKeys = await redis.keys(`*eval-trigger:${tenantIdString}:${traceId}*`);
          if (dedupKeys.length > 0) {
            await redis.del(...dedupKeys);
          }

          await recordSpan(
            buildAppOriginSpan({
              traceId,
              spanId: generateId("s3"),
              depth: 0,
            }),
          );
          await waitFor(() => dispatcher.captured.length >= dispatchesAfter1 + 1, {
            timeoutMs: 20_000,
            label: "fresh depth=0 re-dispatched on the same trace",
          });
          expect(dispatcher.captured.length).toBe(dispatchesAfter1 + 1);
        });
      });
    });

    describe("given the causality-loop operator kill switch", () => {
      describe("when a depth=1 span arrives that would normally be blocked", () => {
        it("the kill switch lets the dispatch through anyway", async () => {
          const traceId = generateId("trace");

          // Seed to establish origin on fold + clear baseline.
          await recordSpan(
            buildAppOriginSpan({
              traceId,
              spanId: generateId("seed"),
              depth: 0,
            }),
          );
          await waitFor(() => dispatcher.captured.length >= 1, {
            timeoutMs: 20_000,
            label: "seed dispatched",
          });
          const dispatchesBefore = dispatcher.captured.length;

          // Clear queue-side dedup so the next eval-trigger isn't suppressed
          // by the 30s window for this trace.
          const redis = getTestRedisConnection()!;
          const dedupKeys = await redis.keys(`*eval-trigger:${tenantIdString}:${traceId}*`);
          if (dedupKeys.length > 0) {
            await redis.del(...dedupKeys);
          }

          featureFlags.setFlag("ops_es_causality_loop_guard_disabled", true);
          try {
            await recordSpan(
              buildAppOriginSpan({
                traceId,
                spanId: generateId("eval"),
                depth: 1,
              }),
            );
            await waitFor(() => dispatcher.captured.length >= dispatchesBefore + 1, {
              timeoutMs: 20_000,
              label: "kill switch lets depth=1 dispatch through the queue",
            });
            expect(dispatcher.captured.length).toBe(dispatchesBefore + 1);
          } finally {
            featureFlags.setFlag("ops_es_causality_loop_guard_disabled", false);
          }
        });
      });
    });
  },
);
