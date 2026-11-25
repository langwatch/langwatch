import { describe, expect, it } from "vitest";

import { budgetCrossingKind, topModelOf } from "../gateway-budget-crossing.rules.ts";

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

describe("topModelOf", () => {
  describe("when one model has most of the spend", () => {
    /** @scenario "A key budget's crossing names the model it spent most on" */
    it("names it with its share of the spend", () => {
      expect(
        topModelOf([
          { model: "claude-sonnet", spentNanoUsd: 380n },
          { model: "gpt-5-mini", spentNanoUsd: 620n },
        ]),
      ).toEqual({ outcome: "named", model: "gpt-5-mini", share: 0.62 });
    });
  });

  describe("when two models tie", () => {
    it("names the first by name, whatever order they were read in", () => {
      const tie = [
        { model: "gpt-5-mini", spentNanoUsd: 500n },
        { model: "claude-sonnet", spentNanoUsd: 500n },
      ];

      const first = { outcome: "named", model: "claude-sonnet", share: 0.5 };

      expect(topModelOf(tie)).toEqual(first);
      expect(topModelOf(tie.toReversed())).toEqual(first);
    });
  });

  describe("when nothing was spent, or the top model has no name", () => {
    it("names none", () => {
      expect(topModelOf([])).toEqual({ outcome: "none" });
      expect(topModelOf([{ model: "gpt-5-mini", spentNanoUsd: 0n }])).toEqual({ outcome: "none" });
      expect(topModelOf([{ model: "", spentNanoUsd: 10n }])).toEqual({ outcome: "none" });
    });
  });
});
