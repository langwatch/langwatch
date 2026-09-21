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
 *   5. LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD=1 bypasses the depth
 *      check (emergency rollback path).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import type {
  MonitorRepository,
  MonitorSummary,
  MonitorWithEvaluator,
} from "~/server/app-layer/monitors/repositories/monitor.repository";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { evaluatorLoopBlockedCounter } from "~/server/metrics";
import { makeQueueName } from "~/server/queues/makeQueueName";
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
import type { ExecuteEvaluationCommandData } from "../../../evaluation-processing/schemas/commands";
import { AssignTopicCommand } from "../../commands/assignTopicCommand";
import { RecordSpanCommand } from "../../commands/recordSpanCommand";
import { SpanStorageMapProjection } from "../../projections/spanStorage.mapProjection";
import { SpanAppendStore } from "../../projections/spanStorage.store";
import { TraceSummaryFoldProjection } from "../../projections/traceSummary.foldProjection";
import { TraceSummaryStore } from "../../projections/traceSummary.store";
import type { TraceProcessingEvent } from "../../schemas/events";
import type { OtlpSpan } from "../../schemas/otlp";
import { createEvaluationTriggerSubscriber } from "../evaluationTrigger.subscriber";

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
      contentDropService: {
        dropSpanContent: async () => ({
          droppedCount: 0,
          droppedCategories: [],
          droppedAttributeKeys: [],
        }),
      },
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
    async findAllByIds() {
      return [];
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

/**
 * The shape the production traces actually had: an evaluator-emitted span
 * whose parent id was fabricated per request and never exported, so the
 * trace has no root span and its origin cannot be settled from a root.
 *
 * Deliberately different from buildAppOriginSpan in three ways that all
 * matter — origin is `evaluation`, the parent id points at a span that will
 * never arrive, and there is no depth=0 application span anywhere on the
 * trace to seed it.
 */
function buildOrphanEvaluatorSpan(opts: {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  depth: number;
  withOrigin?: boolean;
}): OtlpSpan {
  const startNano = BigInt(Date.now()) * 1_000_000n;
  const endNano = startNano + 1_000_000_000n;
  const attrs: Array<{
    key: string;
    value: { stringValue?: string; intValue?: string };
  }> = [
    { key: "langwatch.span.type", value: { stringValue: "workflow" } },
    {
      key: "langwatch.reserved.causality_depth",
      // The OTLP path carries this as an int, which is the case the
      // accumulation change had to handle.
      value: { intValue: String(opts.depth) },
    },
  ];
  if (opts.withOrigin !== false) {
    attrs.push({
      key: "langwatch.origin",
      value: { stringValue: "evaluation" },
    });
  }
  return {
    traceId: opts.traceId,
    spanId: opts.spanId,
    parentSpanId: opts.parentSpanId,
    name: "Random Score",
    kind: 2,
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

      // Build the REAL evaluationTrigger subscriber with a capturing
      // dispatcher and wire it into the pipeline so the
      // GroupQueueProcessor actually fires it when spans land.
      // Override `delay` to 0 — production default is 30s, which is
      // a deliberate dedup window but unhelpful for tests.
      const monitorService = new MonitorService(makeFakeMonitorRepository());
      dispatcher = makeCapturingEvaluationDispatcher();
      const realSubscriber = createEvaluationTriggerSubscriber({
        monitors: monitorService,
        evaluation: dispatcher.dispatch,
      });
      const fastSpec = { ...realSubscriber.spec, delay: 0 };

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
        .withSubscriber("evaluationTrigger", fastSpec as any)
        .withSubscriber("customEvaluationSync", noopFoldSubscriber() as any)
        .withSubscriber("traceUpdateBroadcast", noopFoldSubscriber() as any)
        .withSubscriber("simulationMetricsSync", noopFoldSubscriber() as any)
        .withSubscriber("projectMetadata", noopFoldSubscriber() as any)
        .withSubscriber("spanStorageBroadcast", noopMapSubscriber() as any)
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
        const stale = await redisConnection.keys(
          `${makeQueueName("event-sourcing/jobs")}*`,
        );
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

    /**
     * The incident shape, end to end.
     *
     * Every other scenario in this file dispatches off a span event, where
     * the guard reads the depth from the span in hand. The production traces
     * never took that path: with no root span the origin could not be settled
     * on arrival, so dispatch happened later on origin_resolved — an event
     * carrying no span payload at all. The guard had nothing to read and let
     * the evaluation through, which is what closed the loop.
     *
     * This asserts the two halves of the fix against real infrastructure:
     * the depth survives the fold into ClickHouse and comes back out, and the
     * subscriber blocks on it when the only thing it has is fold state.
     */
    describe("given an orphan evaluator trace with no root span", () => {
      describe("when dispatch happens on origin_resolved", () => {
        /** @scenario A trace already produced by the evaluator does not start another evaluation round */
        it("folds the depth through ClickHouse and blocks the dispatch", async () => {
          const traceId = generateId("trace");

          // A parent id that no span will ever claim. This is what nlpgo
          // minted per request, and why these traces have no root.
          const phantomParent = "8f655e97d0b56ad9";

          await recordSpan(
            buildOrphanEvaluatorSpan({
              traceId,
              spanId: generateId("evalspan"),
              parentSpanId: phantomParent,
              depth: 1,
            }),
          );

          // Half one: the depth made it through the real fold projection and
          // the real ClickHouse round trip. Before the accumulation change
          // this key was dropped, which left the deferred path with nothing
          // to guard on.
          const fold = await traceSummaryStore.get(traceId, {
            tenantId: tenantIdString,
          } as any);
          expect(fold).toBeTruthy();
          expect(fold?.attributes?.["langwatch.reserved.causality_depth"]).toBe(
            "1",
          );
          expect(fold?.attributes?.["langwatch.origin"]).toBe("evaluation");

          // Half two: the subscriber blocks when the only thing it holds is
          // that fold state. A fresh instance keeps this assertion clear of
          // whatever the pipeline's own subscriber already did with the span.
          const deferredDispatcher = makeCapturingEvaluationDispatcher();
          const subscriber = createEvaluationTriggerSubscriber({
            monitors: new MonitorService(makeFakeMonitorRepository()),
            evaluation: deferredDispatcher.dispatch,
          });

          const originResolvedEvent = {
            id: generateId("evt"),
            type: "lw.obs.trace.origin_resolved",
            version: 1,
            aggregateType: "trace",
            aggregateId: traceId,
            tenantId: tenantIdString,
            createdAt: Date.now(),
            occurredAt: Date.now(),
            data: { origin: "evaluation" },
            metadata: { traceId },
          } as unknown as TraceProcessingEvent;

          const context = {
            tenantId: tenantIdString,
            aggregateId: traceId,
            state: fold,
          } as any;

          const beforeBlocked = await readBlockedCounter("depth_fold");
          await subscriber.spec.handler(originResolvedEvent, context);

          expect(deferredDispatcher.captured.length).toBe(0);
          expect(
            (await readBlockedCounter("depth_fold")) - beforeBlocked,
          ).toBeGreaterThanOrEqual(1);

          // Control: the same real trace, same deferred path, with only the
          // depth key removed from the fold — the state this code produced
          // before the fix. It dispatches, which is the bug. This is what
          // makes the assertion above a test of the fix rather than of some
          // other property of the trace.
          const controlDispatcher = makeCapturingEvaluationDispatcher();
          const controlSubscriber = createEvaluationTriggerSubscriber({
            monitors: new MonitorService(makeFakeMonitorRepository()),
            evaluation: controlDispatcher.dispatch,
          });
          const {
            "langwatch.reserved.causality_depth": _dropped,
            ...attributesWithoutDepth
          } = fold?.attributes ?? {};

          await controlSubscriber.spec.handler(originResolvedEvent, {
            tenantId: tenantIdString,
            aggregateId: traceId,
            state: { ...fold, attributes: attributesWithoutDepth },
          } as any);

          expect(controlDispatcher.captured.length).toBe(1);
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
