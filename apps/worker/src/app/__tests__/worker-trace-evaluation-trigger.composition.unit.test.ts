import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import { ExecuteEvaluationCommand } from "@langwatch/evaluation-server";
import type { QueueSendOptions, TriggerContext } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { MonitorService, MonitorSummary } from "@langwatch/monitor-contract";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
import {
  TraceEvaluationDispatchPort,
  TraceEvaluationLoopMetricsPort,
  TraceEvaluationMonitorPort,
  type TraceEvaluationLoopBlockReason,
} from "@langwatch/trace-server";
import { describe, expect, it, vi } from "vitest";
import { createWorkerTraceEvaluationTrigger } from "../worker-trace-evaluation-trigger.composition";

/**
 * Spec: packages/features/trace/specs/evaluation-trigger.feature
 *
 * A COMPOSITION-CAPABILITY test. Trace has not converted, so the application
 * still registers `evaluationTrigger` and nothing here dispatches. What has to
 * be true today is that this composition root can build the subscriber from a
 * published monitor service, a feature-flag service and a queue send — and
 * that the dedup key the queue would squash against is EVALUATION'S own
 * `makeJobId`, reached through the port, not a string this process spells.
 */

function foldState(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "",
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "hello",
    computedOutput: "world",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    LastEventOccurredAt: 0,
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attributes: { "langwatch.origin": "app" },
    ...overrides,
  } as unknown as TraceSummaryData;
}

function spanEvent(attributes: Array<{ key: string; value: unknown }> = []): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {
      span: { name: "openai.chat", spanId: "span-1", parentSpanId: null, attributes },
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
  } as unknown as TraceProcessingEvent;
}

class RecordingLoopMetrics extends TraceEvaluationLoopMetricsPort {
  readonly blocked: TraceEvaluationLoopBlockReason[] = [];

  loopBlocked(reason: TraceEvaluationLoopBlockReason): void {
    this.blocked.push(reason);
  }
}

const monitor: MonitorSummary = {
  id: "check-1",
  checkType: "langevals/basic",
  name: "Monitor One",
  threadIdleTimeout: null,
  evaluator: null,
};

function graph(options: { guardDisabled?: boolean } = {}) {
  const sent: {
    data: ExecuteEvaluationCommandData;
    options?: QueueSendOptions<ExecuteEvaluationCommandData>;
  }[] = [];
  const getEnabledOnMessageMonitors = vi.fn(async () => [monitor]);
  const monitors = { getEnabledOnMessageMonitors } as unknown as MonitorService;
  const featureFlags = {
    isEnabled: vi.fn(async () => options.guardDisabled ?? false),
  } as unknown as FeatureFlagService;
  const metrics = new RecordingLoopMetrics();
  const built = createWorkerTraceEvaluationTrigger({
    monitors,
    featureFlags,
    sendEvaluation: async (data, sendOptions) => {
      sent.push({ data, options: sendOptions });
    },
    metrics,
  });
  return { built, sent, metrics, getEnabledOnMessageMonitors };
}

async function ingest(
  built: ReturnType<typeof createWorkerTraceEvaluationTrigger>,
  event: TraceProcessingEvent,
): Promise<void> {
  const context: TriggerContext<TraceSummaryData> = {
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    state: foldState(),
  };
  await built.subscriber().spec.handler(event, context);
}

describe("createWorkerTraceEvaluationTrigger", () => {
  describe("given a published monitor service and a queue send", () => {
    describe("when the evaluation trigger is composed", () => {
      /** @scenario "The evaluation trigger composes from published services" */
      it("builds the named subscriber over the two narrow ports", () => {
        const { built } = graph();

        expect(built.subscriber().name).toBe("evaluationTrigger");
        expect(built.monitors).toBeInstanceOf(TraceEvaluationMonitorPort);
        expect(built.dispatch).toBeInstanceOf(TraceEvaluationDispatchPort);
      });

      /** @scenario "The composed path dispatches one evaluation per monitor" */
      it("sends a command built from the trace and the monitor", async () => {
        const { built, sent, getEnabledOnMessageMonitors } = graph();

        await ingest(built, spanEvent());

        expect(getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
        expect(sent).toHaveLength(1);
        expect(sent[0]!.data).toMatchObject({
          tenantId: "tenant-1",
          traceId: "trace-1",
          evaluatorId: "check-1",
          evaluatorType: "langevals/basic",
          evaluatorName: "Monitor One",
          isGuardrail: false,
        });
      });

      /**
       * @scenario "The dedup key is the evaluation command's own"
       *
       * The queue squashes a second dispatch against this string. Spelled here
       * rather than asked of Evaluation, it would not collide with the key the
       * application's graph writes, and the same evaluation would run twice
       * while both graphs ingest.
       */
      it("resolves the dedup id through ExecuteEvaluationCommand.makeJobId", async () => {
        const { built, sent } = graph();

        await ingest(built, spanEvent());

        const dispatched = sent[0]!;
        expect(dispatched.options?.deduplication?.makeId(dispatched.data)).toBe(
          ExecuteEvaluationCommand.makeJobId(dispatched.data),
        );
        expect(dispatched.options?.deduplication?.makeId(dispatched.data)).toBe(
          "exec:tenant-1:trace-1:check-1",
        );
        expect(dispatched.options?.deduplication?.ttlMs).toBe(360_000);
        expect(dispatched.options?.deduplication?.shouldSurviveDispatch).toBe(true);
      });
    });
  });

  describe("given a span emitted by an evaluator", () => {
    describe("when it reaches the composed subscriber", () => {
      /**
       * @scenario "The composed loop guard refuses an evaluator's own span"
       *
       * The guard is the difference between an ingested evaluation result and
       * an unbounded fan-out that bills a customer for evaluating its own
       * evaluations.
       */
      it("dispatches nothing and counts the refusal", async () => {
        const { built, sent, metrics } = graph();

        await ingest(
          built,
          spanEvent([{ key: "langwatch.reserved.causality_depth", value: { intValue: 1 } }]),
        );

        expect(sent).toEqual([]);
        expect(metrics.blocked).toEqual(["depth_direct"]);
      });
    });
  });
});
