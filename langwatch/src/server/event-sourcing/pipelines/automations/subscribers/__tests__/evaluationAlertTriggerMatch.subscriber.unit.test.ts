import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "~/server/app-layer/automations/repositories/trigger.repository";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { EvaluationProcessingEvent } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events";
import { createEvaluationAlertTriggerMatchHandler } from "../evaluationAlertTriggerMatch.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function evaluation(
  overrides: Partial<EvaluationRunData> = {},
): EvaluationRunData {
  return {
    evaluationId: "evaluation-1",
    evaluatorId: "evaluator-1",
    traceId: "trace-1",
    status: "processed",
    ...overrides,
  } as EvaluationRunData;
}

function event(
  overrides: Partial<EvaluationProcessingEvent> = {},
): EvaluationProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "evaluation-1",
    aggregateType: "evaluation",
    tenantId: "project-1",
    occurredAt: Date.now(),
    createdAt: Date.now(),
    type: "lw.evaluation.completed",
    version: "2025-01-14",
    data: {},
    ...overrides,
  } as EvaluationProcessingEvent;
}

function trigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Evaluation automation",
    action: TriggerAction.ADD_TO_DATASET,
    triggerKind: TriggerKind.AUTOMATION,
    actionParams: {},
    filters: { "evaluations.passed": { "evaluator-1": ["true"] } },
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    filterQuery: null,
    traceDebounceMs: 30_000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    ...overrides,
  };
}

function context(
  state: EvaluationRunData = evaluation(),
): TriggerContext<EvaluationRunData> {
  return { tenantId: "project-1", aggregateId: "evaluation-1", state };
}

function deps(triggerRows: TriggerSummary[] = [trigger()]) {
  return {
    triggers: {
      getActiveTraceTriggersForProject: vi.fn().mockResolvedValue(triggerRows),
    },
    traceSummaryStore: {
      get: vi
        .fn()
        .mockResolvedValue({ traceId: "trace-1" } as TraceSummaryData),
      store: vi.fn(),
    },
    recordTriggerMatch: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("evaluation alert trigger match subscriber", () => {
  describe("given a terminal evaluation for a trace", () => {
    it("records every evaluation-filtered match with its action class", async () => {
      const dependencies = deps([
        trigger(),
        trigger({ id: "trigger-2", action: TriggerAction.SEND_EMAIL }),
        trigger({
          id: "trace-only",
          filters: { "traces.origin": ["application"] },
        }),
      ]);

      await createEvaluationAlertTriggerMatchHandler({
        ...dependencies,
        triggers: dependencies.triggers as never,
        traceSummaryStore: dependencies.traceSummaryStore as never,
      })(event(), context());

      expect(dependencies.recordTriggerMatch.send).toHaveBeenCalledTimes(2);
      expect(dependencies.recordTriggerMatch.send).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          tenantId: "project-1",
          triggerId: "trigger-1",
          traceId: "trace-1",
          actionClass: "persist",
        }),
      );
      expect(dependencies.recordTriggerMatch.send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          triggerId: "trigger-2",
          actionClass: "notify",
        }),
      );
    });
  });

  describe.each([
    [
      "a stale event",
      event({ occurredAt: Date.now() - 60 * 60 * 1000 - 1 }),
      context(),
    ],
    [
      "an in-progress evaluation",
      event(),
      context(evaluation({ status: "in_progress" })),
    ],
    [
      "an evaluation without a trace",
      event(),
      context(evaluation({ traceId: null })),
    ],
  ])("given %s", (_label, inputEvent, inputContext) => {
    it("does not read the trace or record a match", async () => {
      const dependencies = deps();

      await createEvaluationAlertTriggerMatchHandler({
        ...dependencies,
        triggers: dependencies.triggers as never,
        traceSummaryStore: dependencies.traceSummaryStore as never,
      })(inputEvent, inputContext);

      expect(dependencies.traceSummaryStore.get).not.toHaveBeenCalled();
      expect(dependencies.recordTriggerMatch.send).not.toHaveBeenCalled();
    });
  });

  describe("given the trace fold is unavailable", () => {
    it("drops the match before loading automations", async () => {
      const dependencies = deps();
      dependencies.traceSummaryStore.get.mockResolvedValue(null as never);

      await createEvaluationAlertTriggerMatchHandler({
        ...dependencies,
        triggers: dependencies.triggers as never,
        traceSummaryStore: dependencies.traceSummaryStore as never,
      })(event(), context());

      expect(
        dependencies.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
      expect(dependencies.recordTriggerMatch.send).not.toHaveBeenCalled();
    });
  });
});
