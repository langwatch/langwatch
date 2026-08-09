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
  describe("when the automation has no condition at all", () => {
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
  });

  describe("when something narrows the automation", () => {
    it("does not report a structured filter as matching everything", () => {
      expect(
        isMatchEverythingTrigger(
          trigger({ filters: { "metadata.labels": ["prod"] } }),
        ),
      ).toBe(false);
    });

    it("does not report a query as matching everything", () => {
      expect(
        isMatchEverythingTrigger(trigger({ filterQuery: "status:error" })),
      ).toBe(false);
    });

    it("treats a whitespace-only query as no query at all", () => {
      expect(isMatchEverythingTrigger(trigger({ filterQuery: "   " }))).toBe(
        true,
      );
    });
  });

  describe("when the trigger is not a trace automation", () => {
    // An alert's condition is its threshold and a report's is its schedule, so
    // both legitimately persist an empty filter set.
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
        isMatchEverythingTrigger(trigger({ triggerKind: TriggerKind.REPORT })),
      ).toBe(false);
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
