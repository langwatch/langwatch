import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { QueueSendOptions, TriggerContext } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { TraceEvaluationDispatchPort } from "../../ports/trace-evaluation-dispatch.port";
import {
  TraceEvaluationLoopMetricsPort,
  type TraceEvaluationLoopBlockReason,
} from "../../ports/trace-evaluation-loop-metrics.port";
import { TraceEvaluationMonitorPort } from "../../ports/trace-evaluation-monitor.port";
import { createEvaluationTriggerSubscriber } from "../evaluation-trigger.subscriber";

/**
 * Spec: packages/features/trace/specs/evaluation-trigger.feature
 *
 * REDELIVERY CONTRACT. The same span event reaches this subscriber more than
 * once by design — a late span and the deferred `origin_resolved` event both
 * wake it for the same trace, and the queue redelivers on any handler failure.
 *
 * The externally visible result that must stay singular is ONE EVALUATION RUN
 * per monitor per trace: an evaluation is a charged model call and a result row
 * a customer reads. This subscriber does not remember what it has dispatched;
 * it makes redelivery safe by giving every delivery the SAME command identity,
 * so the queue collapses them.
 *
 * That is only true while the identity ignores the freshly minted
 * `evaluationId`. Each delivery mints a new KSUID, and an identity that
 * included it would be unique per delivery: the dedup would never match, both
 * deliveries would run, and the customer would be billed twice for one trace
 * with two results and no way to tell which is which. That is the property
 * pinned below — and it is a property of the KEY, not of the queue.
 */

function foldState(): TraceSummaryData {
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
  } as unknown as TraceSummaryData;
}

function spanEvent(): TraceProcessingEvent {
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
      span: { name: "openai.chat", spanId: "span-1", parentSpanId: null, attributes: [] },
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
  } as unknown as TraceProcessingEvent;
}

const monitor: MonitorSummary = {
  id: "check-1",
  checkType: "langevals/basic",
  name: "Monitor One",
  threadIdleTimeout: null,
  evaluator: null,
};

/** The evaluation command's real identity, as `ExecuteEvaluationCommand` mints it. */
class Dispatch extends TraceEvaluationDispatchPort {
  readonly sent: {
    data: ExecuteEvaluationCommandData;
    options?: QueueSendOptions<ExecuteEvaluationCommandData>;
  }[] = [];

  makeDedupId(data: ExecuteEvaluationCommandData): string {
    if (data.threadIdleTimeout && data.threadIdleTimeout > 0 && data.threadId) {
      return `exec:${data.tenantId}:thread:${data.threadId}:${data.evaluatorId}`;
    }

    return `exec:${data.tenantId}:${data.traceId}:${data.evaluatorId}`;
  }

  async send(
    data: ExecuteEvaluationCommandData,
    options?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ): Promise<void> {
    this.sent.push({ data, options });
  }
}

class LoopMetrics extends TraceEvaluationLoopMetricsPort {
  loopBlocked(_reason: TraceEvaluationLoopBlockReason): void {}
}

class Monitors extends TraceEvaluationMonitorPort {
  async getEnabledOnMessageMonitors(): Promise<MonitorSummary[]> {
    return [monitor];
  }
}

async function deliverTwice(dispatch: Dispatch): Promise<void> {
  const built = createEvaluationTriggerSubscriber({
    featureFlags: { isEnabled: vi.fn(async () => false) } as unknown as FeatureFlagService,
    monitors: new Monitors(),
    evaluation: dispatch,
    metrics: new LoopMetrics(),
  });
  const context: TriggerContext<TraceSummaryData> = {
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    state: foldState(),
  };

  await built.spec.handler(spanEvent(), context);
  await built.spec.handler(spanEvent(), context);
}

describe("the evaluationTrigger subscriber under redelivery", () => {
  describe("given the same span event is handled twice", () => {
    describe("when the two dispatches reach the queue", () => {
      /** @scenario "A redelivered trace event evaluates once" */
      it("gives both the same command identity, so one evaluation runs", async () => {
        const dispatch = new Dispatch();

        await deliverTwice(dispatch);

        expect(dispatch.sent).toHaveLength(2);
        const [first, second] = dispatch.sent;
        expect(first!.options?.deduplication?.makeId(first!.data)).toBe(
          second!.options?.deduplication?.makeId(second!.data),
        );
        expect(first!.options?.deduplication?.makeId(first!.data)).toBe(
          "exec:tenant-1:trace-1:check-1",
        );
      });

      /** @scenario "The command identity ignores the freshly minted evaluation id" */
      it("mints a fresh evaluation id per delivery that the identity ignores", async () => {
        const dispatch = new Dispatch();

        await deliverTwice(dispatch);

        const [first, second] = dispatch.sent;
        expect(first!.data.evaluationId).not.toBe(second!.data.evaluationId);
        expect(first!.options?.deduplication?.makeId(first!.data)).not.toContain(
          first!.data.evaluationId,
        );
      });

      /** @scenario "The identity outlives the first dispatch" */
      it("keeps the identity alive after the first command dispatches", async () => {
        const dispatch = new Dispatch();

        await deliverTwice(dispatch);

        for (const sent of dispatch.sent) {
          expect(sent.options?.deduplication?.shouldSurviveDispatch).toBe(true);
          expect(sent.options?.deduplication?.ttlMs).toBe(360_000);
        }
      });
    });
  });
});
