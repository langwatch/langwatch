/**
 * Evaluations are not shared in either direction (ADR-185 §5): a span an owner records runs only
 * the owner's monitors, even when a braid shows it in a reader's trace.
 * Spec: modules/trace/specs/braided-spans.feature
 */
import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import { createTenantId } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { MonitorApi, MonitorSummary } from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { SpanReceivedEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type {
  EvaluationLoopBlockReason,
  EvaluationLoopMetrics,
} from "../../features/execution/services/evaluation-loop-metrics.service.ts";
import { createTraceEvaluationTrigger } from "../trace-evaluation-trigger.subscriber.ts";
import {
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
  TRACE_ID,
} from "./trace-span-event.fixtures.ts";

const ORCHESTRATOR = "orchestrator";
const SPECIALISTS = "specialists";
/** A fresh trace: the trigger skips events and traces older than its replay cut-offs. */
const now = Date.now();

const everySpanMonitor: MonitorSummary = {
  id: "monitor-orchestrator-every-span",
  checkType: "langevals/basic",
  name: "Every span",
  threadIdleTimeout: null,
  evaluator: null,
};

class LoopMetrics implements EvaluationLoopMetrics {
  readonly blocked: EvaluationLoopBlockReason[] = [];

  loopBlocked(reason: EvaluationLoopBlockReason): void {
    this.blocked.push(reason);
  }
}

/** Both projects hold the trace; only "orchestrator" has a monitor, and it runs on every span. */
function braidedWorld() {
  const summaries = new Map<string, TraceSummaryData>([
    [ORCHESTRATOR, createFoldState({ occurredAt: now })],
    [SPECIALISTS, createFoldState({ occurredAt: now })],
  ]);
  const monitorsByProject = new Map<string, MonitorSummary[]>([[ORCHESTRATOR, [everySpanMonitor]]]);
  const monitorsAskedFor: string[] = [];
  const queued: ExecuteEvaluationCommandData[] = [];
  const monitors = createApiFixture<Pick<MonitorApi, "getEnabledOnMessageMonitors">>({
    getEnabledOnMessageMonitors: async (projectId) => {
      monitorsAskedFor.push(projectId);
      return monitorsByProject.get(projectId) ?? [];
    },
  });
  const trigger = createTraceEvaluationTrigger({
    findSummary: async ({ projectId }) => summaries.get(projectId) ?? null,
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
    monitors,
    queueTraceEvaluation: async (data) => {
      queued.push(data);
    },
    metrics: new LoopMetrics(),
  });

  /** Delivers a span_received as the evaluation pipeline does: the event's own tenant and trace. */
  async function record(event: SpanReceivedEvent): Promise<void> {
    await trigger({
      tenantId: String(event.tenantId),
      traceId: String(event.aggregateId),
      event: {
        type: event.type,
        occurredAt: event.occurredAt,
        spanAttributes: event.data.span.attributes,
      },
    });
  }

  return { record, monitorsAskedFor, queued };
}

function spanRecordedBy(projectId: string): SpanReceivedEvent {
  const span = {
    ...createOtlpSpan(),
    attributes: [{ key: "orchestrator", value: { stringValue: "web" } }],
  };
  return createSpanReceivedEvent(span, { tenantId: createTenantId(projectId), occurredAt: now });
}

describe("the on-message monitor trigger under a braid", () => {
  describe("when the owner records a span braided into a reader's trace", () => {
    /** @scenario "No reader monitor runs on a braided span" */
    it("never asks for or queues the reader's monitors", async () => {
      const world = braidedWorld();

      await world.record(spanRecordedBy(SPECIALISTS));

      expect(world.monitorsAskedFor).toEqual([SPECIALISTS]);
      expect(world.queued).toEqual([]);
    });
  });

  describe("when the reader records a span of its own in the same trace", () => {
    it("queues the reader's monitor for the reader's project", async () => {
      const world = braidedWorld();

      await world.record(spanRecordedBy(ORCHESTRATOR));

      expect(world.queued).toEqual([
        expect.objectContaining({
          tenantId: ORCHESTRATOR,
          traceId: TRACE_ID,
          evaluatorId: everySpanMonitor.id,
        }),
      ]);
    });
  });
});
