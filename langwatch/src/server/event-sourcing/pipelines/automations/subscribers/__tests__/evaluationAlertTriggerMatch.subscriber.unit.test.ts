import { TriggerAction, TriggerKind } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordTriggerMatchCommand } from "~/server/event-sourcing/pipelines/automations/commands/recordTriggerMatch.command";
import { settleWindowBucket } from "~/server/event-sourcing/pipelines/automations/settleWindow";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "@langwatch/automations/repositories/trigger.repository";
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

  describe("given at-least-once delivery of a committed event", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    describe("when the same event is delivered twice", () => {
      it("sends identical commands yielding one identical idempotency key, regardless of wall-clock at handling time", async () => {
        vi.useFakeTimers();
        const firstDeliveryAt = 1_750_000_000_000;
        vi.setSystemTime(firstDeliveryAt);
        const committedEvent = event({ occurredAt: firstDeliveryAt });
        const deliveryContext = context();
        const dependencies = deps();
        const handler = createEvaluationAlertTriggerMatchHandler({
          ...dependencies,
          triggers: dependencies.triggers as never,
          traceSummaryStore: dependencies.traceSummaryStore as never,
        });

        await handler(committedEvent, deliveryContext);
        // Queue redelivery lands later in wall-clock time.
        vi.advanceTimersByTime(120_000);
        await handler(committedEvent, deliveryContext);

        expect(dependencies.recordTriggerMatch.send).toHaveBeenCalledTimes(2);
        const [firstPayload, secondPayload] =
          dependencies.recordTriggerMatch.send.mock.calls.map(
            ([payload]) => payload,
          );
        expect(secondPayload).toEqual(firstPayload);
        expect(secondPayload.occurredAt).toBe(firstDeliveryAt);

        const idempotencyKeys = await Promise.all(
          [firstPayload, secondPayload].map(async (payload) => {
            const [producedEvent] = await new RecordTriggerMatchCommand().handle(
              {
                tenantId: payload.tenantId,
                data: payload,
              } as never,
            );
            return producedEvent!.idempotencyKey;
          }),
        );
        expect(new Set(idempotencyKeys).size).toBe(1);
        expect(idempotencyKeys[0]).toBe(
          `trigger-1:trace-1:${settleWindowBucket({
            occurredAt: firstDeliveryAt,
            traceDebounceMs: 30_000,
          })}`,
        );
      });
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
