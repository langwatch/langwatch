/**
 * The budget arithmetic: integer nano-USD throughout, so a dollar is a dollar
 * and no float decides it. @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it } from "vitest";

import {
  freeInstantEvalStanding,
  INSTANT_EVAL_FREE_BUDGET_NANO_USD,
  INSTANT_EVAL_FREE_BUDGET_USD,
  instantEvalBudgetRoomNanoUsd,
  instantEvalCommittedUsd,
  isWithinInstantEvalBudget,
  paidInstantEvalStanding,
} from "../instant-eval-budget.rules.ts";

const NANO = 1_000_000_000;

describe("given the free allowance", () => {
  describe("when it is read in either unit", () => {
    /** @scenario "The estimate tells a free organization what is left" */
    it("is one dollar, and the same figure in nano-USD", () => {
      expect(INSTANT_EVAL_FREE_BUDGET_USD).toBe(1);
      expect(INSTANT_EVAL_FREE_BUDGET_NANO_USD).toBe(NANO);
    });
  });
});

describe("given a free organization", () => {
  describe("when it has spent forty cents", () => {
    /** @scenario "The estimate tells a free organization what is left" */
    it("stands at sixty cents remaining", () => {
      expect(freeInstantEvalStanding({ spentNanoUsd: 0.4 * NANO })).toEqual({
        isFree: true,
        spentUsd: 0.4,
        budgetUsd: 1,
        remainingUsd: 0.6,
      });
    });
  });

  describe("when it has spent more than the allowance", () => {
    /** @scenario "At the budget a run is refused" */
    it("has no room left rather than a negative one", () => {
      expect(instantEvalBudgetRoomNanoUsd({ spentNanoUsd: 1.5 * NANO })).toBe(0);
      expect(freeInstantEvalStanding({ spentNanoUsd: 1.5 * NANO }).remainingUsd).toBe(0);
    });
  });
});

describe("given anything the allowance does not bound", () => {
  describe("when it asks where it stands", () => {
    /** @scenario "The estimate tells a paid organization nothing about a free budget" */
    it("is told it has no budget at all", () => {
      expect(paidInstantEvalStanding()).toEqual({
        isFree: false,
        spentUsd: 0,
        budgetUsd: 1,
        remainingUsd: null,
      });
    });
  });
});

describe("given spend, holds and judging not yet recorded", () => {
  describe("when the three are counted together", () => {
    /** @scenario "A run under way counts the runs accepted beside it" */
    it("commits the sum, and is within the budget only strictly below it", () => {
      const committedUsd = instantEvalCommittedUsd({
        spentNanoUsd: 0.4 * NANO,
        heldNanoUsd: 0.3 * NANO,
        inFlightUsd: 0.29,
      });

      expect(committedUsd).toBeCloseTo(0.99, 6);
      expect(isWithinInstantEvalBudget({ committedUsd })).toBe(true);
      expect(isWithinInstantEvalBudget({ committedUsd: 1 })).toBe(false);
    });
  });

  describe("when nothing is in flight", () => {
    /** @scenario "Under the budget a run is accepted" */
    it("counts the ledger and the holds alone", () => {
      expect(
        instantEvalCommittedUsd({ spentNanoUsd: 0.4 * NANO, heldNanoUsd: 0.1 * NANO }),
      ).toBeCloseTo(0.5, 6);
    });
  });
});
