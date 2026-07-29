import { TriggerAction, TriggerKind } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TriggerSummary } from "~/server/app-layer/automations/repositories/trigger.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { RecordTriggerMatchCommand } from "~/server/event-sourcing/pipelines/automations/commands/recordTriggerMatch.command";
import { settleWindowBucket } from "~/server/event-sourcing/pipelines/automations/settleWindow";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/constants";
import type {
  EvaluationCompletedEventData,
  EvaluationProcessingEvent,
} from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { createEvaluationAlertTriggerMatchSubscriber } from "../evaluationAlertTriggerMatch.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function completedEvent(
  data: Partial<EvaluationCompletedEventData> = {},
  overrides: Partial<EvaluationProcessingEvent> = {},
): EvaluationProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "evaluation-1",
    aggregateType: "evaluation",
    tenantId: "project-1",
    occurredAt: Date.now(),
    createdAt: Date.now(),
    type: EVALUATION_COMPLETED_EVENT_TYPE,
    version: "2025-01-14",
    data: {
      evaluationId: "evaluation-1",
      traceId: "trace-1",
      status: "processed",
      ...data,
    },
    ...overrides,
  } as EvaluationProcessingEvent;
}

/**
 * A `completed` event exactly as every row committed before `traceId` was added
 * to the schema decodes: the key is not present at all.
 */
function completedEventWithoutTraceId(): EvaluationProcessingEvent {
  const base = completedEvent();
  const { traceId: _absent, ...data } =
    base.data as EvaluationCompletedEventData;
  return { ...base, data } as EvaluationProcessingEvent;
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

function context(): EventSubscriberContext {
  return { tenantId: "project-1", aggregateId: "evaluation-1" };
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

function subscriberFor(dependencies: ReturnType<typeof deps>) {
  return createEvaluationAlertTriggerMatchSubscriber({
    ...dependencies,
    triggers: dependencies.triggers as never,
    traceSummaryStore: dependencies.traceSummaryStore as never,
  });
}

describe("evaluation alert trigger match subscriber", () => {
  describe("given a terminal evaluation carrying its trace id", () => {
    it("records every evaluation-filtered match with its action class", async () => {
      const dependencies = deps([
        trigger(),
        trigger({ id: "trigger-2", action: TriggerAction.SEND_EMAIL }),
        trigger({
          id: "trace-only",
          filters: { "traces.origin": ["application"] },
        }),
      ]);

      await subscriberFor(dependencies).handle(completedEvent(), context());

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

    it("reads the trace from the event, never from a projection of the same stream", async () => {
      const dependencies = deps();

      await subscriberFor(dependencies).handle(
        completedEvent({ traceId: "trace-from-the-event" }),
        context(),
      );

      expect(dependencies.traceSummaryStore.get).toHaveBeenCalledWith(
        "trace-from-the-event",
        expect.objectContaining({ aggregateId: "trace-from-the-event" }),
      );
      expect(dependencies.recordTriggerMatch.send).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: "trace-from-the-event" }),
      );
    });
  });

  describe("given a reported evaluation", () => {
    it("records the match off the same two fields the completed event carries", async () => {
      const dependencies = deps();

      await subscriberFor(dependencies).handle(
        completedEvent(
          { status: "error", traceId: "trace-9" },
          { type: EVALUATION_REPORTED_EVENT_TYPE },
        ),
        context(),
      );

      expect(dependencies.recordTriggerMatch.send).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: "trace-9", triggerId: "trigger-1" }),
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
        const committedEvent = completedEvent(
          {},
          { occurredAt: firstDeliveryAt },
        );
        const dependencies = deps();
        const subscriber = subscriberFor(dependencies);

        await subscriber.handle(committedEvent, context());
        // Queue redelivery lands later in wall-clock time.
        vi.advanceTimersByTime(120_000);
        await subscriber.handle(committedEvent, context());

        expect(dependencies.recordTriggerMatch.send).toHaveBeenCalledTimes(2);
        const [firstPayload, secondPayload] =
          dependencies.recordTriggerMatch.send.mock.calls.map(
            ([payload]) => payload,
          );
        expect(secondPayload).toEqual(firstPayload);
        expect(secondPayload.occurredAt).toBe(firstDeliveryAt);

        const idempotencyKeys = await Promise.all(
          [firstPayload, secondPayload].map(async (payload) => {
            const [producedEvent] =
              await new RecordTriggerMatchCommand().handle({
                tenantId: payload.tenantId,
                data: payload,
              } as never);
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
      completedEvent({}, { occurredAt: Date.now() - 60 * 60 * 1000 - 1 }),
    ],
    [
      "a non-terminal status",
      completedEvent({ status: "in_progress" as never }),
    ],
    ["an evaluation naming no trace", completedEvent({ traceId: "" })],
    [
      "a completed event committed before the schema carried a trace id",
      completedEventWithoutTraceId(),
    ],
  ])("given %s", (_label, inputEvent) => {
    it("skips without reading the trace, recording a match, or throwing", async () => {
      const dependencies = deps();

      await expect(
        subscriberFor(dependencies).handle(inputEvent, context()),
      ).resolves.toBeUndefined();

      expect(dependencies.traceSummaryStore.get).not.toHaveBeenCalled();
      expect(dependencies.recordTriggerMatch.send).not.toHaveBeenCalled();
    });
  });

  describe("given the trace fold is unavailable", () => {
    it("drops the match before loading automations", async () => {
      const dependencies = deps();
      dependencies.traceSummaryStore.get.mockResolvedValue(null as never);

      await subscriberFor(dependencies).handle(completedEvent(), context());

      expect(
        dependencies.triggers.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
      expect(dependencies.recordTriggerMatch.send).not.toHaveBeenCalled();
    });
  });

  describe("given the subscriber contract", () => {
    it("subscribes to the two terminal evaluation events with no fold bound to it", () => {
      const subscriber = subscriberFor(deps());

      expect(subscriber.name).toBe("triggerMatch");
      expect([...subscriber.eventTypes].sort()).toEqual(
        [
          EVALUATION_COMPLETED_EVENT_TYPE,
          EVALUATION_REPORTED_EVENT_TYPE,
        ].sort(),
      );
    });

    it("carries over the 10s debounce and 30s per-evaluation dedup window", () => {
      const subscriber = subscriberFor(deps());
      const dedup = subscriber.options?.deduplication;

      expect(subscriber.options?.delay).toBe(10_000);
      expect(dedup?.ttlMs).toBe(30_000);
      expect(dedup?.makeId(completedEvent())).toBe(
        "subscriber:triggerMatch:project-1:evaluation-1",
      );
      expect(
        dedup?.makeId(completedEvent({}, { aggregateId: "evaluation-2" })),
      ).not.toBe(dedup?.makeId(completedEvent()));
    });
  });

  describe("given the enqueue filter", () => {
    describe("when the event cannot produce a match", () => {
      it("declines it so no job is ever minted", () => {
        const filter = subscriberFor(deps()).options?.enqueue?.filter;

        expect(filter?.(completedEvent())).toBe(true);
        expect(filter?.(completedEventWithoutTraceId())).toBe(false);
        expect(filter?.(completedEvent({ traceId: "" }))).toBe(false);
        expect(
          filter?.(completedEvent({ status: "in_progress" as never })),
        ).toBe(false);
      });
    });

    describe("when the event payload is malformed", () => {
      it("returns false instead of throwing, because a throw on the routing path loses the job permanently", () => {
        const filter = subscriberFor(deps()).options?.enqueue?.filter;

        for (const data of [null, undefined, "not-an-object", 7, []]) {
          const malformed = {
            ...completedEvent(),
            data,
          } as unknown as EvaluationProcessingEvent;
          expect(() => filter?.(malformed)).not.toThrow();
          expect(filter?.(malformed)).toBe(false);
        }
      });
    });
  });
});
