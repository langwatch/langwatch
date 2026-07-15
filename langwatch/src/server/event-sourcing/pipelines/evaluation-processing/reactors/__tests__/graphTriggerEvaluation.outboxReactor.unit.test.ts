import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import type { GraphEvalStagePayload } from "~/server/event-sourcing/outbox/payload";
import type { EvaluationAnalyticsData } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { EvaluationProcessingEvent } from "../../schemas/events";
import { createEvaluationGraphTriggerEvaluationOutboxReactor } from "../graphTriggerEvaluation.outboxReactor";

const PROJECT_ID = "proj-1";
const TRIGGER_A = "trig-eval-a";
const TRIGGER_B = "trig-eval-b";

function makeGraphTrigger(id: string): TriggerSummary {
  return {
    id,
    projectId: PROJECT_ID,
    name: `Eval Graph ${id}`,
    action: TriggerAction.SEND_EMAIL,
    triggerKind: TriggerKind.ALERT,
    actionParams: {
      threshold: 0.8,
      operator: "lt",
      timePeriod: 60,
      seriesName: "0/evaluations.evaluation_score/avg",
    },
    filters: {},
    alertType: null,
    message: null,
    customGraphId: `graph-${id}`,
    notificationCadence: "immediate",
    filterQuery: null,
    traceDebounceMs: 30_000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
  };
}

function makeEvent(): EvaluationProcessingEvent {
  return {
    tenantId: PROJECT_ID,
    aggregateId: "eval-1",
    occurredAt: Date.now(),
  } as unknown as EvaluationProcessingEvent;
}

function makeContext(): ReactorContext<EvaluationAnalyticsData> {
  return {
    tenantId: PROJECT_ID,
    aggregateId: "eval-1",
    foldState: {} as EvaluationAnalyticsData,
  } as unknown as ReactorContext<EvaluationAnalyticsData>;
}

function makeTriggersStub(graphTriggers: TriggerSummary[]): TriggerService {
  return {
    getActiveTraceTriggersForProject: vi.fn(async () => []),
    getActiveGraphTriggersForProject: vi.fn(async () => graphTriggers),
    claimSend: vi.fn(),
    isSendClaimed: vi.fn(),
    updateLastRunAt: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as TriggerService;
}

describe("evaluation graphTriggerEvaluation outbox reactor", () => {
  describe("when there are graph triggers", () => {
    it("enqueues one graphEval payload per active graph trigger", async () => {
      const triggers = makeTriggersStub([
        makeGraphTrigger(TRIGGER_A),
        makeGraphTrigger(TRIGGER_B),
      ]);

      const reactor = createEvaluationGraphTriggerEvaluationOutboxReactor({
        triggers,
      });
      const result = await reactor.decide(makeEvent(), makeContext());

      expect(result).toHaveLength(2);
      const payloadA = result[0]?.payload as unknown as GraphEvalStagePayload;
      const payloadB = result[1]?.payload as unknown as GraphEvalStagePayload;
      expect(payloadA.stage).toBe("graphEval");
      expect(payloadA.reason).toBe("real-time");
      expect(payloadA.triggerId).toBe(TRIGGER_A);
      expect(payloadB.triggerId).toBe(TRIGGER_B);
      expect(result[0]?.enqueueOptions?.ttlMs).toBe(5_000);
      // Dedup key uses the same `${projectId}/${triggerId}:graph` shape the
      // trace reactor emits, so the dispatcher dedups across pipelines.
      expect(result[0]?.dedupKey).toBe(`${PROJECT_ID}/${TRIGGER_A}:graph`);
      expect(result[1]?.dedupKey).toBe(`${PROJECT_ID}/${TRIGGER_B}:graph`);
    });
  });

  describe("when there are no graph triggers", () => {
    it("returns no enqueue requests", async () => {
      const triggers = makeTriggersStub([]);

      const reactor = createEvaluationGraphTriggerEvaluationOutboxReactor({
        triggers,
      });
      const result = await reactor.decide(makeEvent(), makeContext());

      expect(result).toEqual([]);
    });
  });

  describe("when the event is older than the replay-flood guard", () => {
    it("returns no enqueue requests without loading triggers", async () => {
      const triggers = makeTriggersStub([makeGraphTrigger(TRIGGER_A)]);

      const oldEvent = {
        ...makeEvent(),
        occurredAt: Date.now() - 2 * 60 * 60 * 1000,
      } as EvaluationProcessingEvent;

      const reactor = createEvaluationGraphTriggerEvaluationOutboxReactor({
        triggers,
      });
      const result = await reactor.decide(oldEvent, makeContext());

      expect(result).toEqual([]);
      expect(triggers.getActiveGraphTriggersForProject).not.toHaveBeenCalled();
    });
  });
});
