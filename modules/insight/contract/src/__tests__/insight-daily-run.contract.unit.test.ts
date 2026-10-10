/**
 * What a daily run's request and its board pointer must carry before they reach the module.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { describe, expect, it } from "vitest";

import {
  configureInsightDailyRunInputSchema,
  insightBoardDailyRunScopeSchema,
  insightRunBoardSchema,
  insightRunFindingsSchema,
  requestInsightDailyRunInputSchema,
} from "../insight-daily-run.ts";

const REQUEST = {
  projectId: "project-1",
  userId: "user-1",
  board: { kind: "dashboard", id: "dashboard-1", name: "Costs" },
};

describe("given a board pointer", () => {
  describe("when it has the kind dashboard, the kind template or an unknown kind", () => {
    /** @scenario "A board pointer names a stored board or a template, and nothing else" */
    it("accepts a stored board and a template, and refuses any other kind", () => {
      const pointer = { id: "board-1", name: "Costs" };

      expect(insightRunBoardSchema.validate({ kind: "dashboard", ...pointer })).toBe(true);
      expect(insightRunBoardSchema.validate({ kind: "template", ...pointer })).toBe(true);
      expect(insightRunBoardSchema.validate({ kind: "saved-view", ...pointer })).toBe(false);
      expect(insightRunBoardSchema.validate(pointer)).toBe(false);
    });

    it("refuses a pointer that carries more than a kind, an id and a name", () => {
      const isAccepted = insightRunBoardSchema.validate({
        kind: "dashboard",
        id: "board-1",
        name: "Costs",
        widgets: [{ id: "widget-1" }],
      });

      expect(isAccepted).toBe(false);
    });
  });
});

describe("given a request for a daily run", () => {
  it("takes 3 findings as the maximum when none is named", () => {
    expect(requestInsightDailyRunInputSchema.parse(REQUEST).maxInsights).toBe(3);
  });

  it("refuses a maximum that is not one of the choices", () => {
    expect(requestInsightDailyRunInputSchema.validate({ ...REQUEST, maxInsights: 4 })).toBe(false);
    expect(requestInsightDailyRunInputSchema.validate({ ...REQUEST, maxInsights: 10 })).toBe(true);
  });
});

describe("given the findings a run's answer holds", () => {
  it("refuses a key no finding may carry", () => {
    const finding = { title: "Cost doubled", body: "Cost doubled.", tone: "bad" };

    expect(insightRunFindingsSchema.validate({ findings: [finding] })).toBe(true);
    expect(
      insightRunFindingsSchema.validate({ findings: [{ ...finding, ownerUserId: "user-2" }] }),
    ).toBe(false);
  });
});

describe("given the setting a person sends for a board's daily run", () => {
  const setting = {
    projectId: "project-1",
    board: { kind: "dashboard", id: "dashboard-1", name: "Costs" },
    hour: 9,
    timezone: "Europe/Amsterdam",
    maxInsights: 3,
  };
  const takes = (patch: Record<string, unknown>) =>
    configureInsightDailyRunInputSchema.validate({ ...setting, ...patch });

  it("takes every hour of the day, a named zone and each of the four maximums", () => {
    expect([0, 9, 23].map((hour) => takes({ hour }))).toEqual([true, true, true]);
    expect(
      ["UTC", "Asia/Kolkata", "America/Sao_Paulo"].map((timezone) => takes({ timezone })),
    ).toEqual([true, true, true]);
    expect([1, 3, 5, 10].map((maxInsights) => takes({ maxInsights }))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  /** @scenario "A setting a schedule does not take is refused" */
  it.each([
    ["an hour of 24", { hour: 24 }],
    ["an hour below zero", { hour: -1 }],
    ["half an hour", { hour: 9.5 }],
    ["a zone no one knows", { timezone: "Mars/Olympus_Mons" }],
    ["an offset in place of a zone", { timezone: "+02:00" }],
    ["no zone", { timezone: "" }],
    ["a maximum of 4", { maxInsights: 4 }],
    ["a maximum of 0", { maxInsights: 0 }],
    ["a board of an unknown kind", { board: { kind: "saved-view", id: "view-1", name: "Mine" } }],
  ])("refuses %s", (_what, patch) => {
    expect(takes(patch)).toBe(false);
  });

  it("carries no person: the door names the caller, and a person that was sent is dropped", () => {
    const parsed = configureInsightDailyRunInputSchema.parse({ ...setting, userId: "user-2" });

    expect(parsed).not.toHaveProperty("userId");
  });

  it("reads a board's setting by the pointer's kind and id alone", () => {
    const scope = { projectId: "project-1", board: { kind: "template", id: "llm-costs" } };

    expect(insightBoardDailyRunScopeSchema.validate(scope)).toBe(true);
    expect(
      insightBoardDailyRunScopeSchema.validate({ ...scope, board: { ...scope.board, name: "x" } }),
    ).toBe(false);
  });
});
