import type { FoldProjectionStore, TriggerContext } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { AutomationEvaluationSubscriberService } from "@langwatch/automation-contract";
import { describe, expect, it, vi } from "vitest";
import { createEvaluationProcessingPipeline } from "@langwatch/evaluation-server/internal";
import { ExecuteEvaluationCommand } from "../../src/intents/evaluation-execution.intent";
import type { EvaluationAnalyticsData } from "@langwatch/evaluation-server/internal";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
} from "@langwatch/evaluation-contract";

const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;
import type {
  EvaluationCompletedEvent,
  EvaluationProcessingEvent,
  EvaluationRunData,
} from "@langwatch/evaluation-contract";
import { createEvaluationStartedEvent } from "./fixtures/evaluation-events.fixtures";

const tenantId = createTenantId("project-wiring");

function foldStore<State>(): FoldProjectionStore<State> {
  return {
    get: vi.fn().mockResolvedValue(null),
    store: vi.fn().mockResolvedValue(undefined),
  };
}

function completedEvent(): EvaluationCompletedEvent {
  return {
    id: "evt-completed",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId,
    createdAt: 1_000,
    occurredAt: 1_000,
    type: EVALUATION_COMPLETED_EVENT_TYPE,
    version: "2025-01-14",
    data: {
      evaluationId: "eval-1",
      status: "processed",
    },
  };
}

class TestAutomationEvaluationSubscriberService extends AutomationEvaluationSubscriberService {
  readonly triggerMatchCalls: Array<{
    event: EvaluationProcessingEvent;
    context: TriggerContext<EvaluationRunData>;
  }> = [];
  readonly graphActivityCalls: Array<{
    event: EvaluationProcessingEvent;
    context: { tenantId: string };
  }> = [];

  async handleEvaluationTriggerMatch(
    event: EvaluationProcessingEvent,
    context: TriggerContext<EvaluationRunData>,
  ): Promise<void> {
    this.triggerMatchCalls.push({ event, context });
  }

  async handleEvaluationGraphTriggerActivity(
    event: EvaluationProcessingEvent,
    context: { tenantId: string },
  ): Promise<void> {
    this.graphActivityCalls.push({ event, context });
  }
}

function buildPipeline() {
  const automations = new TestAutomationEvaluationSubscriberService();
  const pipeline = createEvaluationProcessingPipeline({
    evalRunStore: foldStore<EvaluationRunData>(),
    evaluationAnalyticsStore: foldStore<EvaluationAnalyticsData>(),
    evaluationAnalyticsRollupAppendStore: {
      append: vi.fn().mockResolvedValue(undefined),
    },
    executeEvaluationCommand: ExecuteEvaluationCommand.create({
      execute: async () => [],
    }),
    automations,
  });
  return { pipeline, automations };
}

describe("evaluation processing pipeline subscriber wiring", () => {
  describe("given the triggerMatch subscriber", () => {
    it("registers as a fold subscriber on evaluationRun with a 10s delay and 30s dedup ttl", () => {
      const { pipeline } = buildPipeline();

      const entry = pipeline.foldSubscribers.get("triggerMatch");
      expect(entry?.projectionName).toBe("evaluationRun");
      expect(entry?.definition.options?.delay).toBe(10_000);
      expect(entry?.definition.options?.deduplication?.ttlMs).toBe(30_000);
    });

    it("reacts only to evaluation completed/reported events", () => {
      const { pipeline } = buildPipeline();
      const entry = pipeline.foldSubscribers.get("triggerMatch");
      const shouldDispatch = entry?.definition.shouldDispatch;

      const context = {
        tenantId,
        aggregateId: "eval-1",
        foldState: createRunState(),
      };
      expect(shouldDispatch?.(completedEvent(), context)).toBe(true);
      expect(shouldDispatch?.(createEvaluationStartedEvent(), context)).toBe(false);
    });

    it("delegates to Automation's complete subscriber service with committed fold state", async () => {
      const { pipeline, automations } = buildPipeline();
      const entry = pipeline.foldSubscribers.get("triggerMatch");
      const event = completedEvent();
      const foldState = createRunState();

      await entry?.definition.handle(event, {
        tenantId,
        aggregateId: "eval-1",
        foldState,
      });

      expect(automations.triggerMatchCalls).toEqual([
        {
          event,
          context: { tenantId, aggregateId: "eval-1", state: foldState },
        },
      ]);
    });
  });

  describe("given the graphTriggerActivity subscriber", () => {
    it("registers as an event-only subscriber with the graph-trigger debounce delay", () => {
      const { pipeline } = buildPipeline();

      const entry = pipeline.eventSubscribers.get("graphTriggerActivity");
      expect(entry).toBeDefined();
      expect([...(entry?.eventTypes ?? [])].sort()).toEqual(
        [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE].sort(),
      );
      expect(entry?.options?.delay).toBe(GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS);
    });

    it("dedups per tenant with the graph-trigger debounce ttl, without extend/replace", () => {
      const { pipeline } = buildPipeline();
      const entry = pipeline.eventSubscribers.get("graphTriggerActivity");
      const dedup = entry?.options?.deduplication as
        | {
            makeId: (event: EvaluationProcessingEvent) => string;
            ttlMs?: number;
            extend?: boolean;
            replace?: boolean;
          }
        | undefined;

      expect(dedup?.ttlMs).toBe(GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS);
      expect(dedup?.extend).toBe(false);
      expect(dedup?.replace).toBe(false);
      expect(dedup?.makeId(completedEvent())).toBe(`graph-trigger-activity:${tenantId}`);
    });

    it("delegates to Automation's complete subscriber service with tenant context", async () => {
      const { pipeline, automations } = buildPipeline();
      const entry = pipeline.eventSubscribers.get("graphTriggerActivity");
      const event = completedEvent();

      await entry?.handle(event, { tenantId, aggregateId: "eval-1" });

      expect(automations.graphActivityCalls).toEqual([
        {
          event,
          context: { tenantId, aggregateId: "eval-1", state: undefined },
        },
      ]);
    });
  });
});

function createRunState(): EvaluationRunData {
  return {
    evaluationId: "eval-1",
    evaluatorId: "monitor-1",
    evaluatorType: "custom/test",
    evaluatorName: null,
    traceId: null,
    isGuardrail: false,
    status: "scheduled",
    score: null,
    passed: null,
    label: null,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    LastEventOccurredAt: 1_000,
    archivedAt: null,
    scheduledAt: 1_000,
    startedAt: null,
    completedAt: null,
    costId: null,
  };
}
