/**
 * The loop guard reads the SPAN in front of it, never the trace it landed on.
 * @see specs/monitors/online-evaluator-loop-prevention.feature
 */
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

const TRACE_ID = "trace-1";

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

const foldState = (): TraceSummaryData => ({
  traceId: TRACE_ID,
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
  totalPromptTokenCount: null,
  totalCompletionTokenCount: null,
  rootSpanType: null,
  topicId: null,
  subTopicId: null,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  selectedPromptStartTimeMs: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  lastUsedPromptStartTimeMs: null,
  annotationIds: [],
  outputFromRootSpan: false,
  outputSpanEndTimeMs: 0,
  blockedByGuardrail: false,
  containsAi: false,
  containsPrompt: false,
  tokensEstimated: false,
  LastEventOccurredAt: 0,
  occurredAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  attributes: { "langwatch.origin": "app" },
});

const spanAtDepth = ({
  spanId,
  depth,
}: {
  spanId: string;
  depth: number;
}): TraceProcessingEvent => ({
  id: `event-${spanId}`,
  aggregateId: TRACE_ID,
  aggregateType: "trace",
  tenantId: createTenantId("tenant-1"),
  createdAt: Date.now(),
  occurredAt: Date.now(),
  type: SPAN_RECEIVED_EVENT_TYPE,
  version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
  data: {
    span: otlpSpan({
      spanId,
      name: "openai.chat",
      attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: depth } }],
    }),
    resource: null,
    instrumentationScope: null,
    piiRedactionLevel: "STRICT",
  },
  metadata: { spanId, traceId: TRACE_ID },
});

class RecordingDispatch implements TraceEvaluationDispatch {
  readonly sent: ExecuteEvaluationCommandData[] = [];

  makeDedupId(data: ExecuteEvaluationCommandData): string {
    return `exec:${data.tenantId}:${data.traceId}:${data.evaluatorId}`;
  }

  async send(
    data: ExecuteEvaluationCommandData,
    _options?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ): Promise<void> {
    this.sent.push(data);
  }
}

class RecordingMetrics implements TraceEvaluationLoopMetrics {
  readonly blocked: TraceEvaluationLoopBlockReason[] = [];

  loopBlocked(reason: TraceEvaluationLoopBlockReason): void {
    this.blocked.push(reason);
  }
}

/** One subscriber, over one project's monitors, for a whole scenario. */
function trigger() {
  const dispatch = new RecordingDispatch();
  const metrics = new RecordingMetrics();
  class Monitors implements TraceEvaluationMonitor {
    getEnabledOnMessageMonitors(): Promise<MonitorSummary[]> {
      return Promise.resolve([
        {
          id: "check-1",
          checkType: "langevals/basic",
          name: "Monitor One",
          threadIdleTimeout: null,
          evaluator: null,
        },
      ]);
    }
  }
  const built = createEvaluationTriggerSubscriber({
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: vi.fn(async () => false) }),
    monitors: new Monitors(),
    evaluation: dispatch,
    metrics,
  });

  const handle = async (event: TraceProcessingEvent): Promise<void> => {
    const context: TriggerContext<TraceSummaryData> = {
      tenantId: createTenantId("tenant-1"),
      aggregateId: TRACE_ID,
      state: foldState(),
    };
    await built.spec.handler(event, context);
  };

  return { handle, dispatch, metrics };
}

describe("given a trace an evaluator has already written a span to", () => {
  describe("when the customer's application writes to the same trace afterwards", () => {
    /** @scenario "Causality guard is per-span — fresh app activity still re-triggers" */
    it("blocks the evaluator's own span and still dispatches for the fresh one", async () => {
      const { handle, dispatch, metrics } = trigger();

      await handle(spanAtDepth({ spanId: "span-app-1", depth: 0 }));
      const dispatchedBefore = dispatch.sent.length;

      await handle(spanAtDepth({ spanId: "span-evaluator", depth: 1 }));

      expect(metrics.blocked).toEqual(["depth_direct"]);
      expect(dispatch.sent).toHaveLength(dispatchedBefore);

      await handle(spanAtDepth({ spanId: "span-app-2", depth: 0 }));

      expect(dispatch.sent).toHaveLength(dispatchedBefore + 1);
      expect(metrics.blocked).toEqual(["depth_direct"]);
      expect(dispatch.sent.at(-1)?.traceId).toBe(TRACE_ID);
    });
  });
});
