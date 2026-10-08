import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import { createTenantId } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  isSpanReceivedEvent,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  type OtlpKeyValue,
  type OtlpSpan,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type {
  EvaluationLoopMetrics,
  EvaluationLoopBlockReason,
} from "../../services/evaluation-loop-metrics.service.ts";
import { createTraceEvaluationTrigger } from "../trace-evaluation-trigger.subscriber.ts";

/**
 * Spec: modules/evaluation/specs/trace-evaluation-trigger.feature. REDELIVERY CONTRACT:
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

/** Records what trace queued; evaluation's queue owns the dedup over these fields. */
class Dispatch {
  readonly sent: { data: ExecuteEvaluationCommandData }[] = [];

  async send(data: ExecuteEvaluationCommandData): Promise<void> {
    this.sent.push({ data });
  }
}

class LoopMetrics implements EvaluationLoopMetrics {
  loopBlocked(_reason: EvaluationLoopBlockReason): void {}
}

async function deliverTwice(dispatch: Dispatch): Promise<void> {
  const trigger = createTraceEvaluationTrigger({
    findSummary: async () => foldState(),
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: vi.fn(async () => false) }),
    monitors: { getEnabledOnMessageMonitors: async (): Promise<MonitorSummary[]> => [monitor] },
    queueTraceEvaluation: (data) => dispatch.send(data),
    metrics: new LoopMetrics(),
  });
  const event = spanEvent();
  const delivery = {
    tenantId: "tenant-1",
    traceId: "trace-1",
    event: {
      type: event.type,
      occurredAt: event.occurredAt,
      spanAttributes: isSpanReceivedEvent(event) ? event.data.span.attributes : undefined,
    },
  };

  await trigger(delivery);
  await trigger(delivery);
}

describe("the trace evaluation trigger under redelivery", () => {
  describe("given the same span event is handled twice", () => {
    describe("when the two dispatches reach the queue", () => {
      /** @scenario "A redelivered trace event evaluates once" */
      it("gives both the same command identity, so one evaluation runs", async () => {
        const dispatch = new Dispatch();

        await deliverTwice(dispatch);

        expect(dispatch.sent).toHaveLength(2);
        const [first, second] = dispatch.sent;
        const identity = (sent: { data: ExecuteEvaluationCommandData }) => ({
          tenantId: sent.data.tenantId,
          traceId: sent.data.traceId,
          evaluatorId: sent.data.evaluatorId,
        });
        expect(identity(first!)).toEqual(identity(second!));
        expect(identity(first!)).toEqual({
          tenantId: "tenant-1",
          traceId: "trace-1",
          evaluatorId: "check-1",
        });
      });

      /** @scenario "The command identity ignores the freshly minted evaluation id" */
      it("mints a fresh evaluation id per delivery that the identity ignores", async () => {
        const dispatch = new Dispatch();

        await deliverTwice(dispatch);

        const [first, second] = dispatch.sent;
        expect(first!.data.evaluationId).not.toBe(second!.data.evaluationId);
      });
    });
  });
});
