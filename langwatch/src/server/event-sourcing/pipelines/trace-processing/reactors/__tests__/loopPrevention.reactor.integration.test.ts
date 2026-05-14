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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type {
  SpanReceivedEvent,
  TraceProcessingEvent,
} from "../../schemas/events";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../schemas/constants";
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

/**
 * Mirrors the SpanReceivedEvent shape produced by recordSpan's
 * emitEvents step. The reactor reads `event.data.span.attributes` for
 * the depth check, and `event.occurredAt` for the recency gate. Other
 * fields are passed through to dispatchEvaluations but not consulted
 * by the loop-prevention logic.
 */
function buildSpanReceivedEvent(opts: {
  tenantId: string;
  traceId: string;
  span: OtlpSpan;
}): SpanReceivedEvent {
  return {
    type: SPAN_RECEIVED_EVENT_TYPE,
    tenantId: opts.tenantId,
    aggregateId: opts.traceId,
    occurredAt: Date.now(),
    data: {
      span: opts.span as any,
      resource: { attributes: [], droppedAttributesCount: 0 } as any,
      instrumentationScope: { name: "langwatch.test" } as any,
      piiRedactionLevel: "DISABLED",
    },
    metadata: {
      spanId: (opts.span as any).spanId,
      traceId: opts.traceId,
    },
  } as unknown as SpanReceivedEvent;
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
  "evaluationTrigger reactor — loop prevention against real pipeline state",
  () => {
    let eventSourcing: EventSourcing;
    let tracePipeline: ReturnType<typeof createTracePipeline>;
    let traceSummaryStore: TraceSummaryStore;
    let tenantId: ReturnType<typeof createTestTenantId>;
    let tenantIdString: string;
    let dispatcher: ReturnType<typeof makeCapturingEvaluationDispatcher>;
    let reactor: ReturnType<typeof createEvaluationTriggerReactor>;

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
      // dispatcher. We won't rely on the BullMQ-scheduled call path;
      // the test invokes reactor.handle() directly with foldState
      // read from CH. The reactor instance is the production code.
      const monitorService = new MonitorService(makeFakeMonitorRepository());
      dispatcher = makeCapturingEvaluationDispatcher();
      reactor = createEvaluationTriggerReactor({
        monitors: monitorService,
        evaluation: dispatcher.dispatch,
      });

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
        .withReactor("traceSummary", "evaluationTrigger", noopReactor as any)
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
     * Sends one recordSpan command and waits for the trace_summaries
     * row to land in ClickHouse with a resolved origin. Returns the
     * persisted foldState — the same shape the reactor receives in
     * production via ReactorContext.foldState.
     */
    async function sendSpanAndAwaitFold(
      span: OtlpSpan,
    ): Promise<TraceSummaryData> {
      await tracePipeline.commands.recordSpan.send({
        tenantId: tenantIdString,
        span: span as any,
        resource: { attributes: [], droppedAttributesCount: 0 } as any,
        instrumentationScope: { name: "langwatch.test" } as any,
        piiRedactionLevel: "DISABLED",
        occurredAt: Date.now(),
      });

      let fold: TraceSummaryData | null = null;
      await waitFor(
        async () => {
          fold = await traceSummaryStore.get(
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
      if (!fold) throw new Error("fold became null after waitFor");
      return fold;
    }

    /** @scenario Incoming span with causality_depth=0 still triggers evaluations */
    it("dispatches one executeEvaluation per monitor when depth=0", async () => {
      const traceId = generateId("trace");
      const spanId = generateId("span");
      const span = buildAppOriginSpan({ traceId, spanId, depth: 0 });

      const foldState = await sendSpanAndAwaitFold(span);
      expect(foldState.attributes["langwatch.origin"]).toBe("application");

      await reactor.handle(buildSpanReceivedEvent({
        tenantId: tenantIdString,
        traceId,
        span,
      }) as any, {
        tenantId: tenantIdString,
        aggregateId: traceId,
        foldState,
      } as any);

      expect(dispatcher.captured).toHaveLength(1);
      expect(dispatcher.captured[0]!.evaluatorId).toBe(
        "monitor_test_loop_prevention",
      );
      expect(dispatcher.captured[0]!.tenantId).toBe(tenantIdString);
      expect(dispatcher.captured[0]!.traceId).toBe(traceId);
    });

    /** @scenario Incoming span with causality_depth=1 does not trigger evaluations */
    it("BLOCKS dispatch when the incoming span carries causality_depth=1", async () => {
      const traceId = generateId("trace");

      // First seed the trace with an app-origin span so foldState has
      // a resolved origin (otherwise the originGuardedReactor returns
      // early before reaching the depth check).
      const seedSpan = buildAppOriginSpan({
        traceId,
        spanId: generateId("seed"),
        depth: 0,
      });
      const foldState = await sendSpanAndAwaitFold(seedSpan);
      expect(foldState.attributes["langwatch.origin"]).toBe("application");

      // Now construct the eval-emitted span (depth=1) and invoke the
      // reactor with it as the incoming event.
      const evalSpan = buildAppOriginSpan({
        traceId,
        spanId: generateId("eval"),
        depth: 1,
      });

      const beforeBlocked = await readBlockedCounter("depth_direct");
      const dispatchesBefore = dispatcher.captured.length;

      await reactor.handle(buildSpanReceivedEvent({
        tenantId: tenantIdString,
        traceId,
        span: evalSpan,
      }) as any, {
        tenantId: tenantIdString,
        aggregateId: traceId,
        foldState,
      } as any);

      expect(dispatcher.captured.length).toBe(dispatchesBefore);
      const afterBlocked = await readBlockedCounter("depth_direct");
      expect(afterBlocked - beforeBlocked).toBe(1);
    });

    /** @scenario Causality guard is per-span — fresh app activity still re-triggers */
    it("re-dispatches when a fresh depth=0 span arrives after a depth=1 noise span", async () => {
      const traceId = generateId("trace");

      // 1. Initial app-origin span — should dispatch.
      const span1 = buildAppOriginSpan({
        traceId,
        spanId: generateId("s1"),
        depth: 0,
      });
      const fold1 = await sendSpanAndAwaitFold(span1);
      await reactor.handle(buildSpanReceivedEvent({
        tenantId: tenantIdString,
        traceId,
        span: span1,
      }) as any, {
        tenantId: tenantIdString,
        aggregateId: traceId,
        foldState: fold1,
      } as any);
      const dispatchesAfter1 = dispatcher.captured.length;
      expect(dispatchesAfter1).toBe(1);

      // 2. Eval-emitted span on same trace (depth=1) — must NOT add a dispatch.
      const span2 = buildAppOriginSpan({
        traceId,
        spanId: generateId("s2"),
        depth: 1,
      });
      // The eval-emitted span also goes through the real pipeline.
      const fold2 = await sendSpanAndAwaitFold(span2);
      await reactor.handle(buildSpanReceivedEvent({
        tenantId: tenantIdString,
        traceId,
        span: span2,
      }) as any, {
        tenantId: tenantIdString,
        aggregateId: traceId,
        foldState: fold2,
      } as any);
      expect(dispatcher.captured.length).toBe(dispatchesAfter1);

      // 3. Fresh app-origin span (depth=0) later on SAME trace —
      //    legitimate new activity, MUST dispatch again.
      const span3 = buildAppOriginSpan({
        traceId,
        spanId: generateId("s3"),
        depth: 0,
      });
      const fold3 = await sendSpanAndAwaitFold(span3);
      await reactor.handle(buildSpanReceivedEvent({
        tenantId: tenantIdString,
        traceId,
        span: span3,
      }) as any, {
        tenantId: tenantIdString,
        aggregateId: traceId,
        foldState: fold3,
      } as any);
      expect(dispatcher.captured.length).toBe(dispatchesAfter1 + 1);
    });

    /** @scenario LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD bypasses depth check */
    it("kill switch — LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD=1 dispatches even on depth=1", async () => {
      const traceId = generateId("trace");
      const seedSpan = buildAppOriginSpan({
        traceId,
        spanId: generateId("seed"),
        depth: 0,
      });
      const foldState = await sendSpanAndAwaitFold(seedSpan);

      const evalSpan = buildAppOriginSpan({
        traceId,
        spanId: generateId("eval"),
        depth: 1,
      });

      const prev = process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD;
      process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD = "1";
      try {
        const dispatchesBefore = dispatcher.captured.length;
        await reactor.handle(buildSpanReceivedEvent({
          tenantId: tenantIdString,
          traceId,
          span: evalSpan,
        }) as any, {
          tenantId: tenantIdString,
          aggregateId: traceId,
          foldState,
        } as any);
        expect(dispatcher.captured.length).toBe(dispatchesBefore + 1);
      } finally {
        if (prev === undefined) {
          delete process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD;
        } else {
          process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD = prev;
        }
      }
    });
  },
);
