import { createApiFixture } from "@langwatch/api-fixture";
import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import { createTenantId, type QueueSendOptions, type TriggerContext } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  type OtlpKeyValue,
  type OtlpSpan,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  type TraceEvaluationDispatch,
  type TraceEvaluationLoopMetrics,
  type TraceEvaluationLoopBlockReason,
  type TraceEvaluationMonitor,
} from "../../app/trace.members.ts";
import { createEvaluationTriggerSubscriber } from "../evaluation-trigger.subscriber.ts";

/**
 * Spec: modules/trace/specs/evaluation-trigger.feature. REDELIVERY CONTRACT:
 * fires more than once by design, so identity must ignore the freshly minted
 * `evaluationId`, or dedup never matches and the customer gets double-billed.
 */

function otlpSpan({
  spanId,
  name,
  attributes,
}: {
  spanId: string;
  name: string;
  attributes: OtlpKeyValue[];
}): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId,
    parentSpanId: null,
    name,
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes,
    events: [],
    links: [],
    status: { code: null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

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
  };
}

function spanEvent(): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: createTenantId("tenant-1"),
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      span: otlpSpan({ spanId: "span-1", name: "openai.chat", attributes: [] }),
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
  };
}

const monitor: MonitorSummary = {
  id: "check-1",
  checkType: "langevals/basic",
  name: "Monitor One",
  threadIdleTimeout: null,
  evaluator: null,
};

/** The evaluation command's real identity, as `ExecuteEvaluationCommand` mints it. */
class Dispatch implements TraceEvaluationDispatch {
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

class LoopMetrics implements TraceEvaluationLoopMetrics {
  loopBlocked(_reason: TraceEvaluationLoopBlockReason): void {}
}

class Monitors implements TraceEvaluationMonitor {
  async getEnabledOnMessageMonitors(): Promise<MonitorSummary[]> {
    return [monitor];
  }
}

async function deliverTwice(dispatch: Dispatch): Promise<void> {
  const built = createEvaluationTriggerSubscriber({
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: vi.fn(async () => false) }),
    monitors: new Monitors(),
    evaluation: dispatch,
    metrics: new LoopMetrics(),
  });
  const context: TriggerContext<TraceSummaryData> = {
    tenantId: createTenantId("tenant-1"),
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
