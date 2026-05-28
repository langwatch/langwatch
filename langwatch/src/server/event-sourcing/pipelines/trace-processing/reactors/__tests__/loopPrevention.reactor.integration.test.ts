/**
 * Real integration test for online-evaluator loop prevention.
 *
 * Scope (honest):
 *   - Uses testcontainers (Redis + ClickHouse) — REAL infrastructure.
 *   - Drives recordSpan through the REAL EventSourcing pipeline,
 *     real TraceSummaryFoldProjection, real CH writes.
 *   - Reads fold state back from REAL ClickHouse.
 *   - Invokes the REAL evaluationTrigger reactor's handle() with a
 *     constructed event + foldState (read from CH) to assert on the
 *     loop-prevention behaviour.
 *
 *   The reactor's BullMQ queue worker is NOT exercised in this test.
 *   That is harness plumbing, not feature behaviour, and other reactor
 *   integration tests in this codebase (e.g.
 *   customEvaluationSync.reactor.integration.test.ts) are `.skip`'d for
 *   the same reason — making BullMQ reactor pickup reliable in the
 *   vitest harness is a separate problem from "does the reactor
 *   correctly block depth>=1 spans against real fold state from real
 *   ClickHouse." This test answers the latter, which is the
 *   post-2026-05-11 incident question.
 *
 * What this test proves:
 *   1. recordSpan + the trace-processing pipeline + CH persistence
 *      survive a depth=0 span and produce a foldState with
 *      langwatch.origin resolved.
 *   2. The REAL evaluationTrigger reactor (createEvaluationTriggerReactor)
 *      against that REAL foldState DISPATCHES one executeEvaluation
 *      per enabled ON_MESSAGE monitor.
 *   3. The same reactor with a depth=1 span event BLOCKS dispatch
 *      and increments the `langwatch_evaluator_loop_blocked_total`
 *      counter with reason="depth_direct".
 *   4. The same reactor with a fresh depth=0 span on the same trace
 *      DISPATCHES again. The guard is per-span, not per-trace —
 *      legitimate new app activity must still re-trigger evaluation.
 *   5. LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD=1 bypasses the depth
 *      check (emergency rollback path).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import type { AggregateType } from "../../../..";
import { definePipeline } from "../../../..";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
} from "../../../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  createTestTenantId,
  getTenantIdString,
} from "../../../../__tests__/integration/testHelpers";
import { EventSourcing } from "../../../../eventSourcing";
import { EventStoreClickHouse } from "../../../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../../../stores/repositories/eventRepositoryClickHouse";
import { RecordSpanCommand } from "../../commands/recordSpanCommand";
import { AssignTopicCommand } from "../../commands/assignTopicCommand";
import { SpanStorageMapProjection } from "../../projections/spanStorage.mapProjection";
import {
  TraceSummaryFoldProjection,
  type TraceSummaryData,
} from "../../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../../schemas/events";
import type { OtlpSpan } from "../../schemas/otlp";
import { SpanAppendStore } from "../../projections/spanStorage.store";
import { TraceSummaryStore } from "../../projections/traceSummary.store";
import { createEvaluationTriggerReactor } from "../evaluationTrigger.reactor";
import { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import type {
  MonitorRepository,
  MonitorSummary,
  MonitorWithEvaluator,
} from "~/server/app-layer/monitors/repositories/monitor.repository";
import type { ExecuteEvaluationCommandData } from "../../../evaluation-processing/schemas/commands";
import { evaluatorLoopBlockedCounter } from "~/server/metrics";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

// ---------------------------------------------------------------------------
// Fakes wired into the real pipeline.
// ---------------------------------------------------------------------------

class TestRecordSpanCommand extends RecordSpanCommand {
  static override readonly schema = RecordSpanCommand.schema;
  constructor() {
    super({
      piiRedactionService: { redactSpan: async () => {} },
      costEnrichmentService: { enrichSpan: async () => {} },
      tokenEstimationService: { estimateSpanTokens: async () => {} },
    });
  }
}

function makeFakeMonitorRepository(): MonitorRepository {
  const monitor: MonitorSummary = {
    id: "monitor_test_loop_prevention",
    checkType: "workflow",
    name: "Loop Prevention Test Monitor",
    threadIdleTimeout: null,
    evaluator: { name: "test/evaluator" },
  };
  const fullMonitor: MonitorWithEvaluator = {
    id: monitor.id,
    checkType: monitor.checkType,
    sample: 1.0,
    preconditions: null,
    parameters: null,
    mappings: null,
    level: null,
    evaluator: {
      config: {},
      type: "workflow",
      workflowId: "wf_test",
    },
  };
  return {
    async getEnabledOnMessageMonitors() {
      return [monitor];
    },
    async getMonitorById() {
      return fullMonitor;
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

const noopReactor = { name: "noop", options: {}, handle: async () => {} };

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
  "evaluationTrigger reactor — loop prevention end-to-end through the real event-sourcing pipeline",
  () => {
    let eventSourcing: EventSourcing;
    let tracePipeline: ReturnType<typeof createTracePipeline>;
    let traceSummaryStore: TraceSummaryStore;
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;
    let dispatcher: ReturnType<typeof makeCapturingEvaluationDispatcher>;

    function createTracePipeline() {
      const clickHouseClient = getTestClickHouseClient();
      const redisConnection = getTestRedisConnection();
      if (!clickHouseClient || !redisConnection) {
        throw new Error("ClickHouse + Redis required.");
      }

      const eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(async () => clickHouseClient),
      );
      eventSourcing = EventSourcing.createWithStores({
        eventStore,
        clickhouse: async () => clickHouseClient,
        redis: redisConnection,
        processRole: "worker",
      });

      const spanAppendStore = new SpanAppendStore(
        new SpanStorageService(
          new SpanStorageClickHouseRepository(async () => clickHouseClient),
        ).repository,
      );
      traceSummaryStore = new TraceSummaryStore(
        new TraceSummaryService(
          new TraceSummaryClickHouseRepository(async () => clickHouseClient),
        ).repository,
      );

      // Build the REAL evaluationTrigger reactor with a capturing
      // dispatcher and wire it into the pipeline so the
      // GroupQueueProcessor actually fires it when spans land.
      // Override `delay` to 0 — production default is 30s, which is
      // a deliberate dedup window but unhelpful for tests.
      const monitorService = new MonitorService(makeFakeMonitorRepository());
      dispatcher = makeCapturingEvaluationDispatcher();
      const realReactor = createEvaluationTriggerReactor({
        monitors: monitorService,
        evaluation: dispatcher.dispatch,
      });
      const fastReactor = {
        ...realReactor,
        options: { ...realReactor.options, delay: 0 },
      };

      const pipelineName = `trace_loop_prevention_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const pipelineDef = definePipeline<TraceProcessingEvent>()
        .withName(pipelineName)
        .withAggregateType("trace" as AggregateType)
        .withFoldProjection(
          "traceSummary",
          new TraceSummaryFoldProjection({ store: traceSummaryStore }) as any,
        )
        .withMapProjection(
          "spanStorage",
          new SpanStorageMapProjection({ store: spanAppendStore }) as any,
        )
        .withReactor("traceSummary", "evaluationTrigger", fastReactor as any)
        .withReactor("traceSummary", "customEvaluationSync", noopReactor as any)
        .withReactor("traceSummary", "traceUpdateBroadcast", noopReactor as any)
        .withReactor("traceSummary", "simulationMetricsSync", noopReactor as any)
        .withReactor("traceSummary", "projectMetadata", noopReactor as any)
        .withReactor("spanStorage", "spanStorageBroadcast", noopReactor as any)
        .withCommand("recordSpan", TestRecordSpanCommand as any)
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
    // block this run's reactors from picking up work. Flush once
    // before any test in this suite executes.
    beforeAll(async () => {
      const redisConnection = getTestRedisConnection();
      if (redisConnection) {
        await redisConnection.flushall();
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
     * fold projection definitely ran before we move on. Reactor
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
          const fold = await traceSummaryStore.get(
            (span as any).traceId,
            { tenantId: tenantIdString } as any,
          );
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
     * reactor is dispatched asynchronously by the GroupQueueProcessor;
     * `recordSpan` only awaits the fold. We need to give the worker a
     * polling cycle to pick up the reactor job and either call dispatch
     * or block it. 1500ms is comfortably above the dispatcher's BRPOP
     * timeout cadence at signalTimeoutSec=5 with delay=0 jobs.
     */
    async function quietReactorWindow(): Promise<void> {
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
            label: "reactor dispatched evaluation through the real queue",
          });

          expect(dispatcher.captured).toHaveLength(1);
          expect(dispatcher.captured[0]!.evaluatorId).toBe(
            "monitor_test_loop_prevention",
          );
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
      // on the fold (required for the originGuardedReactor wrapper
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

      // Eval-emitted span (depth=1) — must be blocked by the reactor.
      await recordSpan(
        buildAppOriginSpan({
          traceId,
          spanId: generateId("eval"),
          depth: 1,
        }),
      );
      // Poll the prom counter instead of sleeping a fixed 1500ms. The
      // reactor → BullMQ → metric write chain can take longer than that
      // under parallel CI load, which flaked this test (PR #4189 CI:
      // `expected 0 to be greater than or equal to 1`). The dispatch
      // assertion stays as a post-condition: by the time the blocked
      // counter ticks the reactor has decided not to dispatch.
      await waitFor(
        async () =>
          (await readBlockedCounter("depth_direct")) > beforeBlocked,
        {
          timeoutMs: 20_000,
          label: "loop-blocked counter incremented for depth_direct",
        },
      );

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
      //    dispatch. The reactor dedup window (30s makeJobId TTL) is
      //    irrelevant here because the depth check returns BEFORE the
      //    queue's dedup applies — that's exactly the guarantee.
      await recordSpan(
        buildAppOriginSpan({
          traceId,
          spanId: generateId("s2"),
          depth: 1,
        }),
      );
      await quietReactorWindow();
      expect(dispatcher.captured.length).toBe(dispatchesAfter1);

      // 3. Fresh app-origin span (depth=0) later on SAME trace —
      //    legitimate new activity, MUST dispatch again. The reactor
      //    has `makeJobId(...) = eval-trigger:tenant:trace` plus a
      //    30s TTL — to bypass the queue-side dedup of this case we
      //    nuke the dedup keys for this trace before re-dispatching.
      //    (In production, the 30s window IS the dedup; tests just
      //    need to prove the depth check itself doesn't pin the
      //    trace forever.)
      const redis = getTestRedisConnection()!;
      const dedupKeys = await redis.keys(
        `*eval-trigger:${tenantIdString}:${traceId}*`,
      );
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
      await waitFor(
        () => dispatcher.captured.length >= dispatchesAfter1 + 1,
        {
          timeoutMs: 20_000,
          label: "fresh depth=0 re-dispatched on the same trace",
        },
      );
          expect(dispatcher.captured.length).toBe(dispatchesAfter1 + 1);
        });
      });
    });

    describe("given LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD=1", () => {
      describe("when a depth=1 span arrives that would normally be blocked", () => {
        /** @scenario LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD bypasses depth check */
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
      const dedupKeys = await redis.keys(
        `*eval-trigger:${tenantIdString}:${traceId}*`,
      );
      if (dedupKeys.length > 0) {
        await redis.del(...dedupKeys);
      }

      const prev = process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD;
      process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD = "1";
      try {
        await recordSpan(
          buildAppOriginSpan({
            traceId,
            spanId: generateId("eval"),
            depth: 1,
          }),
        );
        await waitFor(
          () => dispatcher.captured.length >= dispatchesBefore + 1,
          {
            timeoutMs: 20_000,
            label: "kill switch lets depth=1 dispatch through the queue",
          },
        );
        expect(dispatcher.captured.length).toBe(dispatchesBefore + 1);
      } finally {
        if (prev === undefined) {
          delete process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD;
        } else {
          process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD = prev;
        }
      }
        });
      });
    });
  },
);
