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
  const counted: number[] = [];
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
    metrics: {
      countRecorded: (count: number) => {
        counted.push(count);
      },
    },
  };
  return { deps, reads, matches, counted };
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

    describe("when the matches are recorded", () => {
      /** @scenario "Match-record volume is measured for the team, not capped" */
      it("counts every record written on the team metric", async () => {
        const { deps, counted } = harness();

        await handleTraceAlertTriggerMatch(
          deps,
          { occurredAt: 1_000 },
          { tenantId: "project-1", aggregateId: "trace-1" },
        );

        expect(counted).toEqual([1]);
      });

      /** @scenario "Recording a match consumes nothing" */
      it("records through triggers, the match recorder and the metric alone", async () => {
        const { deps, matches } = harness();

        await handleTraceAlertTriggerMatch(
          deps,
          { occurredAt: 1_000 },
          { tenantId: "project-1", aggregateId: "trace-1" },
        );

        expect({ deps: Object.keys(deps), recorded: matches.length }).toEqual({
          deps: ["triggers", "triggerMatches", "metrics"],
          recorded: 1,
        });
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
