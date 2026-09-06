/**
 * The loop guard reads the SPAN in front of it, never the trace it landed on.
 * @see specs/monitors/online-evaluator-loop-prevention.feature
 */
import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { QueueSendOptions, TriggerContext } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { MonitorSummary } from "@langwatch/monitor-contract";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceEvaluationDispatchPort } from "../../ports/trace-evaluation-dispatch.port.ts";
import {
  TraceEvaluationLoopMetricsPort,
  type TraceEvaluationLoopBlockReason,
} from "../../ports/trace-evaluation-loop-metrics.port.ts";
import { TraceEvaluationMonitorPort } from "../../ports/trace-evaluation-monitor.port.ts";
import { createEvaluationTriggerSubscriber } from "../evaluation-trigger.subscriber.ts";

const TRACE_ID = "trace-1";

const foldState = (): TraceSummaryData =>
  ({
    traceId: TRACE_ID,
    traceName: "",
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "hello",
    computedOutput: "world",
    containsErrorStatus: false,
    containsOKStatus: true,
    models: [],
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
  }) as unknown as TraceSummaryData;

const spanAtDepth = ({ spanId, depth }: { spanId: string; depth: number }): TraceProcessingEvent =>
  ({
    id: `event-${spanId}`,
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {
      span: {
        name: "openai.chat",
        spanId,
        parentSpanId: null,
        attributes: [{ key: "langwatch.reserved.causality_depth", value: { intValue: depth } }],
      },
    },
    metadata: { spanId, traceId: TRACE_ID },
  }) as unknown as TraceProcessingEvent;

class RecordingDispatch extends TraceEvaluationDispatchPort {
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

class RecordingMetrics extends TraceEvaluationLoopMetricsPort {
  readonly blocked: TraceEvaluationLoopBlockReason[] = [];

  loopBlocked(reason: TraceEvaluationLoopBlockReason): void {
    this.blocked.push(reason);
  }
}

/** One subscriber, over one project's monitors, for a whole scenario. */
function trigger() {
  const dispatch = new RecordingDispatch();
  const metrics = new RecordingMetrics();
  class Monitors extends TraceEvaluationMonitorPort {
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
    featureFlags: { isEnabled: vi.fn(async () => false) } as unknown as FeatureFlagService,
    monitors: new Monitors(),
    evaluation: dispatch,
    metrics,
  });

  const handle = async (event: TraceProcessingEvent): Promise<void> => {
    const context: TriggerContext<TraceSummaryData> = {
      tenantId: "tenant-1",
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
