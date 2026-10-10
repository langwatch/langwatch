/**
 * What a daily run's request and its board pointer must carry before they reach the module.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { describe, expect, it } from "vitest";

import {
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
