import { describe, expect, it } from "vitest";

import { budgetCrossingKind } from "../gateway-budget-crossing.rules.ts";

describe("budgetCrossingKind", () => {
  describe("when spend sits below the warn line", () => {
    /** @scenario "Spend below the warn line records no crossing" */
    it("answers no crossing", () => {
      expect(budgetCrossingKind({ spentUsd: 79.99, limitUsd: 100 })).toBe("not_crossed");
    });
  });

  describe("when spend reaches the warn line or the limit", () => {
    it("answers threshold at 80% and breached at 100%", () => {
      expect(budgetCrossingKind({ spentUsd: 80, limitUsd: 100 })).toBe("threshold_crossed");
      expect(budgetCrossingKind({ spentUsd: 99.99, limitUsd: 100 })).toBe("threshold_crossed");
      expect(budgetCrossingKind({ spentUsd: 100, limitUsd: 100 })).toBe("breached");
    });
  });

  describe("when the budget has no positive limit", () => {
    /** @scenario "A budget without a positive limit never crosses" */
    it("never crosses, whatever was spent", () => {
      expect(budgetCrossingKind({ spentUsd: 5, limitUsd: 0 })).toBe("not_crossed");
      expect(budgetCrossingKind({ spentUsd: 5, limitUsd: -1 })).toBe("not_crossed");
    });
  });
});
