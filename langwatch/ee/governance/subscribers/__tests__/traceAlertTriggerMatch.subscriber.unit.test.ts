// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { TriggerAction, TriggerKind } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordTriggerMatchCommand } from "~/server/event-sourcing/pipelines/automations/commands/recordTriggerMatch.command";
import { settleWindowBucket } from "~/server/event-sourcing/pipelines/automations/settleWindow";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "@langwatch/automations/repositories/trigger.repository";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { createTraceAlertTriggerMatchHandler } from "../traceAlertTriggerMatch.subscriber";

function traceState(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    computedInput: "private input",
    computedOutput: "private output",
    blockedByGuardrail: false,
    occurredAt: Date.now(),
    attributes: { "langwatch.origin": "application" },
    ...overrides,
  } as TraceSummaryData;
}

function event(
  overrides: Partial<TraceProcessingEvent> = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "project-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-01-14",
    data: {},
    ...overrides,
  } as TraceProcessingEvent;
}

function trigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Trace automation",
    action: TriggerAction.SEND_EMAIL,
    triggerKind: TriggerKind.AUTOMATION,
    actionParams: { members: ["ops@example.com"] },
    filters: {},
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "5min_digest",
    filterQuery: null,
    traceDebounceMs: 45_000,
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
  state: TraceSummaryData = traceState(),
): TriggerContext<TraceSummaryData> {
  return { tenantId: "project-1", aggregateId: "trace-1", state };
}

describe("trace alert trigger match subscriber", () => {
  describe("given trace-only notify and persist automations", () => {
    it("records ID-only matches with their dispatch timing", async () => {
      const triggers = {
        getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([
          trigger(),
          trigger({
            id: "trigger-2",
            action: TriggerAction.ADD_TO_DATASET,
            notificationCadence: "immediate",
          }),
        ]),
      };
      const recordTriggerMatch = { send: vi.fn().mockResolvedValue(undefined) };

      await createTraceAlertTriggerMatchHandler({
        triggers: triggers as never,
        recordTriggerMatch,
      })(event(), context());

      expect(recordTriggerMatch.send).toHaveBeenCalledTimes(2);
      expect(recordTriggerMatch.send).toHaveBeenNthCalledWith(1, {
        tenantId: "project-1",
        occurredAt: expect.any(Number),
        triggerId: "trigger-1",
        traceId: "trace-1",
        action: TriggerAction.SEND_EMAIL,
        actionClass: "notify",
        traceDebounceMs: 45_000,
        notificationCadence: "5min_digest",
      });
      expect(recordTriggerMatch.send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          triggerId: "trigger-2",
          traceId: "trace-1",
          actionClass: "persist",
        }),
      );
      expect(JSON.stringify(recordTriggerMatch.send.mock.calls)).not.toContain(
        "private input",
      );
    });
  });

  describe("given an automation with evaluation filters", () => {
    it("leaves the match to the evaluation subscriber", async () => {
      const triggers = {
        getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([
          trigger({
            filters: {
              "evaluations.passed": { "evaluator-1": ["true"] },
            },
          }),
        ]),
      };
      const recordTriggerMatch = { send: vi.fn().mockResolvedValue(undefined) };

      await createTraceAlertTriggerMatchHandler({
        triggers: triggers as never,
        recordTriggerMatch,
      })(event(), context());

      expect(recordTriggerMatch.send).not.toHaveBeenCalled();
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
        const deliveryContext = context(
          traceState({ occurredAt: firstDeliveryAt }),
        );
        const triggers = {
          getActiveTraceTriggersForProject: vi
            .fn()
            .mockResolvedValue([trigger()]),
        };
        const recordTriggerMatch = {
          send: vi.fn().mockResolvedValue(undefined),
        };
        const handler = createTraceAlertTriggerMatchHandler({
          triggers: triggers as never,
          recordTriggerMatch,
        });

        await handler(committedEvent, deliveryContext);
        // Queue redelivery lands later in wall-clock time.
        vi.advanceTimersByTime(120_000);
        await handler(committedEvent, deliveryContext);

        expect(recordTriggerMatch.send).toHaveBeenCalledTimes(2);
        const [firstPayload, secondPayload] =
          recordTriggerMatch.send.mock.calls.map(([payload]) => payload);
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
            traceDebounceMs: 45_000,
          })}`,
        );
      });
    });
  });

  describe("given a trace rejected by the origin guards", () => {
    it("does not fetch automations or record a match", async () => {
      const triggers = {
        getActiveTraceTriggersForProject: vi
          .fn()
          .mockResolvedValue([trigger()]),
      };
      const recordTriggerMatch = { send: vi.fn().mockResolvedValue(undefined) };

      await createTraceAlertTriggerMatchHandler({
        triggers: triggers as never,
        recordTriggerMatch,
      })(event(), context(traceState({ attributes: {} })));

      expect(triggers.getActiveTraceTriggersForProject).not.toHaveBeenCalled();
      expect(recordTriggerMatch.send).not.toHaveBeenCalled();
    });
  });
});
