/** @see modules/automation/specs/automation.feature */
import type { TriggerMatchRecordedEventData, TriggerSummary } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { handleTraceAlertTriggerMatch } from "../trace-alert-trigger-match.subscriber.ts";

function trigger(id: string, filters: Record<string, unknown>): TriggerSummary {
  return {
    id,
    projectId: "project-1",
    name: id,
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    actionParams: {},
    filters,
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
}

function harness() {
  const reads: string[] = [];
  const matches: (TriggerMatchRecordedEventData & { tenantId: string; occurredAt: number })[] = [];
  const deps = {
    triggers: {
      findActiveTraceTriggersForProject: async (projectId: string) => {
        reads.push(projectId);
        return [
          trigger("trace-only", { "spans.model": ["gpt-5"] }),
          trigger("reads-evaluations", { "evaluations.evaluator_id": ["evaluator-1"] }),
        ];
      },
    },
    triggerMatches: {
      send: async (input: (typeof matches)[number]) => {
        matches.push(input);
      },
    },
  };
  return { deps, reads, matches };
}

describe("handleTraceAlertTriggerMatch", () => {
  describe("given a trace-only automation and one that reads evaluations", () => {
    describe("when trace hands over a settled trace", () => {
      /** @scenario "An origin-guarded trace records a match per trace trigger that reads no evaluation" */
      it("records one match for the trace-only automation", async () => {
        const { deps, matches } = harness();

        await handleTraceAlertTriggerMatch(
          deps,
          { occurredAt: 1_000 },
          { tenantId: "project-1", aggregateId: "trace-1" },
        );

        expect(matches).toEqual([
          {
            tenantId: "project-1",
            occurredAt: 1_000,
            triggerId: "trace-only",
            traceId: "trace-1",
            action: "SEND_EMAIL",
            actionClass: "notify",
            traceDebounceMs: 30_000,
            notificationCadence: "immediate",
          },
        ]);
      });
    });

    describe("when the event names no trace", () => {
      /** @scenario "A trace event with no aggregate records no match" */
      it("reads nothing and records nothing", async () => {
        const { deps, reads, matches } = harness();

        await handleTraceAlertTriggerMatch(deps, { occurredAt: 1_000 }, { tenantId: "project-1" });

        expect({ reads, matches }).toEqual({ reads: [], matches: [] });
      });
    });
  });
});
