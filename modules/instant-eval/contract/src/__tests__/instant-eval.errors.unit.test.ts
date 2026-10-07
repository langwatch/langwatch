import { describe, expect, it } from "vitest";

import { InstantEvalFreeBudgetExhaustedError } from "../instant-eval.errors.ts";

describe("free budget refusal", () => {
  describe("given a paid organization the meter does not bill has spent one dollar", () => {
    const refusal = new InstantEvalFreeBudgetExhaustedError({ spentUsd: 1, budgetUsd: 1 });

    /** @scenario "A paid organization refused by the free budget is not told to upgrade" */
    it("is refused with the free budget exhausted error", () => {
      expect(refusal.code).toBe("instant_eval_free_budget_exhausted");
    });

    /** @scenario "A paid organization refused by the free budget is not told to upgrade" */
    it("does not ask it to upgrade to a paid plan", () => {
      expect(refusal.message).not.toMatch(/upgrade|paid plan/i);
    });

    it("names the budget and both ways to keep judging", () => {
      expect(refusal.message).toBe(
        "This organization has used its $1 of free Instant Evals. To keep judging, pick another model for this judge or contact us to turn on usage billing.",
      );
    });
  });
});
