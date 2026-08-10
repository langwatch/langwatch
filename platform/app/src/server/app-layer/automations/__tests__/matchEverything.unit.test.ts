import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { confirmSettledMatch } from "../dispatch/confirmSettledMatch";
import { isMatchEverythingTrigger } from "../matchEverything";
import type { TriggerSummary } from "../repositories/trigger.repository";

function trigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: "trigger_1",
    projectId: "project_1",
    name: "Automation",
    action: TriggerAction.ADD_TO_DATASET,
    triggerKind: TriggerKind.AUTOMATION,
    actionParams: {},
    filters: {},
    filterQuery: null,
    alertType: null,
    message: null,
    customGraphId: null,
    notificationCadence: "immediate",
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

describe("isMatchEverythingTrigger", () => {
  describe("given an automation with no condition at all", () => {
    describe("when the trigger is classified", () => {
      it("reports it as matching everything", () => {
        expect(isMatchEverythingTrigger(trigger())).toBe(true);
      });

      it("reports a filter set whose only field selects nothing the same way", () => {
        expect(
          isMatchEverythingTrigger(
            trigger({ filters: { "metadata.labels": [] } }),
          ),
        ).toBe(true);
      });

      // The write validation and this classifier share one vacuity check, so a
      // key-selector wrapper with no leaf values has to read as no condition in
      // both. Counting the wrapper here would hide exactly the automations that
      // go on to fire on every trace.
      it("reports a key selector with no values the same way", () => {
        expect(
          isMatchEverythingTrigger(
            trigger({ filters: { "metadata.labels": { region: [] } } }),
          ),
        ).toBe(true);
      });

      it("treats a whitespace-only query as no query at all", () => {
        expect(isMatchEverythingTrigger(trigger({ filterQuery: "   " }))).toBe(
          true,
        );
      });
    });
  });

  describe("given something narrows the automation", () => {
    describe("when the trigger is classified", () => {
      it("does not report a structured filter as matching everything", () => {
        expect(
          isMatchEverythingTrigger(
            trigger({ filters: { "metadata.labels": ["prod"] } }),
          ),
        ).toBe(false);
      });

      it("does not report a populated key selector as matching everything", () => {
        expect(
          isMatchEverythingTrigger(
            trigger({ filters: { "metadata.labels": { region: ["eu"] } } }),
          ),
        ).toBe(false);
      });

      it("does not report a query as matching everything", () => {
        expect(
          isMatchEverythingTrigger(trigger({ filterQuery: "status:error" })),
        ).toBe(false);
      });
    });
  });

  describe("given the trigger is not a trace automation", () => {
    describe("when the trigger is classified", () => {
      // An alert's condition is its threshold and a report's is its schedule,
      // so both legitimately persist an empty filter set.
      it("never reports a graph alert", () => {
        expect(
          isMatchEverythingTrigger(
            trigger({
              triggerKind: TriggerKind.ALERT,
              customGraphId: "graph_1",
            }),
          ),
        ).toBe(false);
      });

      it("never reports a report", () => {
        expect(
          isMatchEverythingTrigger(
            trigger({ triggerKind: TriggerKind.REPORT }),
          ),
        ).toBe(false);
      });
    });
  });

  describe("given a graph-backed automation with no filters", () => {
    describe("when the trigger is classified", () => {
      // Deliberately AUTOMATION-kind, so the kind guard cannot short-circuit
      // and this pins the customGraphId guard on its own. A graph automation
      // is driven by its graph, not by its filter set, so an empty `filters`
      // here is normal and must never make it a pause candidate.
      it("never reports it as matching everything", () => {
        expect(
          isMatchEverythingTrigger(
            trigger({
              triggerKind: TriggerKind.AUTOMATION,
              customGraphId: "graph_1",
              filters: {},
              filterQuery: null,
            }),
          ),
        ).toBe(false);
      });
    });
  });
});

describe("grandfathered condition-less automations", () => {
  /** @scenario "Automations that predate the rule keep firing" */
  it("still confirms their matches at dispatch time", async () => {
    // The write paths refuse this shape now. Rows saved before that rule keep
    // running unchanged: refusing them at dispatch would silently break
    // automations a customer is relying on, on a deploy they did not ask for.
    const confirmed = await confirmSettledMatch({
      deps: {
        evaluationRuns: {
          findByTraceId: async () => [],
        } as never,
        deriveEvents: async () => [],
      },
      trigger: trigger(),
      projectId: "project_1",
      traceId: "trace_1",
      foldState: {
        computedInput: "hi",
        computedOutput: "there",
        attributes: {},
        containsErrorStatus: false,
        models: [],
        annotationIds: [],
      } as never,
    });

    expect(confirmed).toBe(true);
  });
});
