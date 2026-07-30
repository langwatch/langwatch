// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { TriggerSummary } from "~/server/app-layer/automations/repositories/trigger.repository";
import {
  createTraceAlertTriggerMatchSubscriber,
  type TraceSummaryForTriggerMatch,
} from "../traceAlertTriggerMatch.subscriber";

const CTX = { now: Date.now(), tenantId: "project-1" };

function spanEvent(occurredAt = Date.now()) {
  return {
    type: "lw.obs.trace.span_received",
    data: { traceId: "trace-1", occurredAt },
  };
}

function traceSummary(
  overrides: Partial<TraceSummaryForTriggerMatch> = {},
): TraceSummaryForTriggerMatch {
  return {
    occurredAt: Date.now(),
    blockedByGuardrail: false,
    computedOutput: "private output",
    attributes: { "langwatch.origin": "application" },
    ...overrides,
  };
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

function build(args: {
  triggers?: TriggerSummary[];
  readTraceSummary?: () => Promise<TraceSummaryForTriggerMatch | null>;
}) {
  const recordTriggerMatch = { send: vi.fn().mockResolvedValue(undefined) };
  const subscriber = createTraceAlertTriggerMatchSubscriber({
    triggers: {
      getActiveTraceTriggersForProject: vi
        .fn()
        .mockResolvedValue(args.triggers ?? [trigger()]),
    },
    recordTriggerMatch,
    readTraceSummary: args.readTraceSummary ?? (async () => traceSummary()),
  });
  return { subscriber, recordTriggerMatch };
}

describe("trace alert trigger match subscriber", () => {
  it("listens to span_received and origin_resolved", () => {
    const { subscriber } = build({});
    expect(subscriber.eventTypes).toEqual([
      "lw.obs.trace.span_received",
      "lw.obs.trace.origin_resolved",
    ]);
  });

  describe("given trace-only notify and persist automations", () => {
    it("records a match per trigger", async () => {
      const { subscriber, recordTriggerMatch } = build({
        triggers: [
          trigger(),
          trigger({
            id: "trigger-2",
            action: TriggerAction.ADD_TO_DATASET,
            notificationCadence: "immediate",
          }),
        ],
      });

      await subscriber.handle(spanEvent(), CTX);

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
          actionClass: "persist",
        }),
      );
    });
  });

  describe("given an automation with evaluation filters", () => {
    it("leaves the match to the evaluation subscriber", async () => {
      const { subscriber, recordTriggerMatch } = build({
        triggers: [trigger({ filters: { "evaluations.passed": true } })],
      });

      await subscriber.handle(spanEvent(), CTX);

      expect(recordTriggerMatch.send).not.toHaveBeenCalled();
    });
  });

  describe("given the trace summary has not committed yet", () => {
    it("throws so the runtime retries instead of dropping the alert", async () => {
      const { subscriber, recordTriggerMatch } = build({
        readTraceSummary: async () => null,
      });

      await expect(subscriber.handle(spanEvent(), CTX)).rejects.toThrow(
        /Trace summary not found/,
      );
      expect(recordTriggerMatch.send).not.toHaveBeenCalled();
    });
  });

  describe("given a trace rejected by the origin guards", () => {
    it("does not fetch automations or record a match", async () => {
      const triggersPort = {
        getActiveTraceTriggersForProject: vi
          .fn()
          .mockResolvedValue([trigger()]),
      };
      const recordTriggerMatch = { send: vi.fn().mockResolvedValue(undefined) };
      const subscriber = createTraceAlertTriggerMatchSubscriber({
        triggers: triggersPort,
        recordTriggerMatch,
        readTraceSummary: async () => traceSummary({ attributes: {} }),
      });

      await subscriber.handle(spanEvent(), CTX);

      expect(
        triggersPort.getActiveTraceTriggersForProject,
      ).not.toHaveBeenCalled();
      expect(recordTriggerMatch.send).not.toHaveBeenCalled();
    });
  });
});
