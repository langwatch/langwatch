import { describe, expect, it } from "vitest";

import { budgetBarLabel } from "../ui/elements/virtual-key-budget-bar.tsx";

const value = (window: string) => ({
  budgetId: "budget-1",
  window,
  limitUsd: "3",
  periodSpentUsd: "1",
  resetsAt: "9999-12-31T00:00:00Z",
});

describe("budgetBarLabel", () => {
  describe("given a MANUAL budget", () => {
    /** @scenario "A MANUAL budget reads as resetting on request, never at a far-future date" */
    it("names no reset time", () => {
      expect(budgetBarLabel(value("MANUAL"))).not.toMatch(/resets/);
    });
  });

  describe("given a daily budget", () => {
    it("names when it resets", () => {
      expect(budgetBarLabel({ ...value("DAY"), resetsAt: "2099-01-01T00:00:00Z" })).toMatch(
        /resets/,
      );
    });
  });
});
