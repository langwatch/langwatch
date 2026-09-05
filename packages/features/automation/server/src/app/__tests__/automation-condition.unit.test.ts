/**
 * @see specs/automations/authoring-drawer.feature
 * An automation with no condition matches every trace forever, so the easiest create call
 * produced the most expensive automation. Editing is the other route to the same state.
 */
import { describe, expect, it, vi } from "vitest";

import type { AutomationAppDependencies } from "../automation.app";
import { AutomationApp } from "../automation.app";

const CREATED = { id: "trigger_new", triggerKind: "AUTOMATION" };

function app(): { app: AutomationApp; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => CREATED);
  return {
    create,
    app: AutomationApp.create({ automation: { create } } as unknown as AutomationAppDependencies),
  };
}

const storedWithCondition = {
  id: "trigger_1",
  triggerKind: "AUTOMATION",
  filterQuery: null,
  filters: { "spans.model": ["gpt-5-mini"] },
} as never;

describe("given a create request for a trace automation", () => {
  describe("when it carries no condition at all", () => {
    /** @scenario "Creating an automation with no condition is refused" */
    it("refuses it with the condition-required code and persists nothing", async () => {
      const { app: automation, create } = app();

      await expect(
        automation.createTraceAutomation({
          id: "trigger_new",
          name: "No condition",
          action: "SEND_SLACK_MESSAGE",
          actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
          filters: {},
          projectId: "project_1",
          message: null,
          alertType: null,
        } as never),
      ).rejects.toMatchObject({ code: "trigger_filters_required", httpStatus: 422 });

      expect(create).not.toHaveBeenCalled();
    });

    /**
     * A shallow vacuity check counted the outer key as a condition while the matcher
     * discarded the empty leaf, so this shape saved cleanly and then fired on every trace.
     */
    /** @scenario "Creating an automation with no condition is refused" */
    it("refuses a key selector that carries no values", async () => {
      const { app: automation, create } = app();

      await expect(
        automation.createTraceAutomation({
          id: "trigger_new",
          name: "Vacuous key selector",
          action: "SEND_SLACK_MESSAGE",
          actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
          filters: { "metadata.labels": { region: [] } },
          projectId: "project_1",
          message: null,
          alertType: null,
        } as never),
      ).rejects.toMatchObject({ code: "trigger_filters_required" });

      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when its only condition is a query string", () => {
    /** @scenario "A query is a condition on its own" */
    it("creates the automation with an empty structured set", async () => {
      const { app: automation, create } = app();

      // The edit rule is where a query stands in for the structured set: an
      // automation whose condition lives in its query keeps a legitimately
      // empty `filters`, and clearing that set is not clearing the condition.
      expect(() =>
        automation.assertConditionSurvivesEdit({
          existing: {
            id: "trigger_1",
            triggerKind: "AUTOMATION",
            filterQuery: "status:error",
            filters: { "spans.model": ["gpt-5-mini"] },
          } as never,
          filters: {},
        }),
      ).not.toThrow();
      expect(create).not.toHaveBeenCalled();
    });
  });
});

describe("given a graph alert or a scheduled report", () => {
  describe("when it is created with no trace condition", () => {
    /**
     * An alert's condition IS its threshold and a report's is its schedule, so neither has
     * a trace filter to require — they write through `create`, which carries no such rule.
     */
    /** @scenario "Alerts and reports do not need a trace condition" */
    it("creates it without asking for a trace condition", async () => {
      const { app: automation, create } = app();

      await expect(
        automation.create({
          id: "trigger_new",
          name: "Latency alert",
          action: "SEND_SLACK_MESSAGE",
          actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
          filters: {},
          projectId: "project_1",
          message: null,
          alertType: "WARNING",
        } as never),
      ).resolves.toEqual(CREATED);

      expect(create).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Alerts and reports do not need a trace condition" */
    it("lets an alert's edit clear the structured set", () => {
      const { app: automation } = app();

      expect(() =>
        automation.assertConditionSurvivesEdit({
          existing: {
            id: "trigger_1",
            triggerKind: "ALERT",
            filterQuery: null,
            filters: {},
          } as never,
          filters: {},
        }),
      ).not.toThrow();
    });
  });
});

describe("given an existing trace automation with a condition", () => {
  describe("when an edit replaces its condition with an empty one", () => {
    /** @scenario "Editing an automation down to no condition is refused" */
    it("refuses the edit with the condition-required code", () => {
      const { app: automation } = app();

      expect(() =>
        automation.assertConditionSurvivesEdit({
          existing: storedWithCondition,
          filters: {},
        }),
      ).toThrow(expect.objectContaining({ code: "trigger_filters_required" }));
    });
  });

  describe("when an edit does not mention the condition", () => {
    /** @scenario "Editing an automation down to no condition is refused" */
    it("leaves the stored condition alone", () => {
      const { app: automation } = app();

      expect(() =>
        automation.assertConditionSurvivesEdit({
          existing: storedWithCondition,
          filters: undefined,
        }),
      ).not.toThrow();
    });
  });
});
