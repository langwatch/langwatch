/**
 * What a judgement costs us, and what it is sold for.
 * @see specs/instant-evals/instant-eval-cost.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_PRICING,
  instantEvalCostUsd,
  instantEvalPriceUsd,
} from "../instant-eval-pricing.rules.ts";

describe("given a response from the classifier", () => {
  describe("when the cost is computed", () => {
    /** @scenario "The cost is the tokens at the classifier's published rate" */
    it("charges the published rate for the input tokens only", () => {
      expect(instantEvalCostUsd({ inputTokens: 1_000_000 })).toBeCloseTo(
        INSTANT_EVAL_PRICING.usdPerMillionInputTokens,
        10,
      );
      expect(instantEvalCostUsd({ inputTokens: 2_000_000 })).toBeCloseTo(
        INSTANT_EVAL_PRICING.usdPerMillionInputTokens * 2,
        10,
      );
    });

    /** @scenario "A run that judged nothing reports no spend" */
    it("charges nothing for a judgement that sent nothing", () => {
      expect(instantEvalCostUsd({ inputTokens: 0 })).toBe(0);
    });
  });

  describe("when the customer price is computed", () => {
    /** @scenario "The customer price is the cost at the published markup" */
    it("is the cost times the markup", () => {
      const costUsd = instantEvalCostUsd({ inputTokens: 2_000_000 });

      expect(instantEvalPriceUsd({ costUsd })).toBeCloseTo(
        costUsd * INSTANT_EVAL_PRICING.markup,
        10,
      );
    });
  });
});

describe("given a judgement whose raw product carries float noise", () => {
  describe("when its cost and price are computed", () => {
    /** @scenario "A priced amount is rounded to nano-USD precision" */
    it("rounds both to the ledger's nano-USD unit", () => {
      const costUsd = instantEvalCostUsd({ inputTokens: 211_727 });
      const priceUsd = instantEvalPriceUsd({ costUsd });

      expect(costUsd).toBe(0.008892534);
      expect(priceUsd).toBe(0.011560294);
      expect(String(priceUsd)).not.toMatch(/0000000\d$/);
    });
  });
});
