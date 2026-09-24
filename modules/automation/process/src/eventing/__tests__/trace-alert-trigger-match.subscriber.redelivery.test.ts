import type { TriggerMatchRecordedEventData, TriggerSummary } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { handleTraceAlertTriggerMatch } from "../trace-alert-trigger-match.subscriber.ts";

const TRIGGER: TriggerSummary = {
  id: "trace-only",
  projectId: "project-1",
  name: "Trace automation",
  action: "SEND_SLACK_MESSAGE",
  triggerKind: "AUTOMATION",
  actionParams: {},
  filters: {},
  filterQuery: null,
  alertType: "WARNING",
  message: "",
  customGraphId: null,
  notificationCadence: "immediate",
  traceDebounceMs: 30_000,
  templates: {
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
  },
};

describe("handleTraceAlertTriggerMatch redelivery", () => {
  describe("given the same trace event delivered twice", () => {
    it("sends one match identity, which the recorder settles once", async () => {
      const recorded = new Map<string, TriggerMatchRecordedEventData>();
      const deps = {
        triggers: { findActiveTraceTriggersForProject: async () => [TRIGGER] },
        triggerMatches: {
          send: async (input: TriggerMatchRecordedEventData & { occurredAt: number }) => {
            recorded.set(`${input.triggerId}:${input.traceId}:${input.occurredAt}`, input);
          },
        },
      };
      const context = { tenantId: "project-1", aggregateId: "trace-1" };

      await handleTraceAlertTriggerMatch(deps, { occurredAt: 5 }, context);
      await handleTraceAlertTriggerMatch(deps, { occurredAt: 5 }, context);

      expect([...recorded.keys()]).toEqual(["trace-only:trace-1:5"]);
    });
  });
});
