/**
 * What a judgement costs us, and what it is sold for.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-pricing.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_PRICING,
  instantEvalCostUsd,
  instantEvalJudgementRoutedSpendOf,
  instantEvalPriceUsd,
  instantEvalRoutedSpendOf,
  toNanoUsdPrecision,
} from "../instant-eval-pricing.ts";

describe("given a response from the classifier", () => {
  describe("when the cost is computed", () => {
    /** @scenario "The cost is the tokens at the classifier's published rate" */
    /** @scenario "Cost is the input tokens at the published rate, and output is free" */
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
    /** @scenario "The customer price carries the platform markup" */
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

    /** @scenario "A priced amount is rounded to nano-USD precision" */
    it("rounds a summed amount the same way, for a caller that adds costs", () => {
      expect(toNanoUsdPrecision(0.1 + 0.2)).toBe(0.3);
      expect(toNanoUsdPrecision(0.0000000014)).toBe(0.000000001);
    });
  });
});

describe("given a spend that may be routed", () => {
  describe("when its routed part is read", () => {
    /** @scenario "Routed and unrouted tokens are billed separately" */
    it("is routed when it has routed tokens or a routed cost above zero, and unrouted otherwise", () => {
      expect(instantEvalRoutedSpendOf({})).toBeUndefined();
      expect(instantEvalRoutedSpendOf({ costNanoUsd: 0, routedInputTokens: 0 })).toBeUndefined();
      // A backend that bills output tokens alone has a cost and no routed input tokens.
      expect(instantEvalRoutedSpendOf({ costNanoUsd: 5000, routedInputTokens: 0 })).toEqual({
        costNanoUsd: 5000,
        routedInputTokens: 0,
      });
      expect(instantEvalRoutedSpendOf({ costNanoUsd: 0, routedInputTokens: 40 })).toEqual({
        costNanoUsd: 0,
        routedInputTokens: 40,
      });
    });

    /** @scenario "A routed judgement with a cost of zero is still routed" */
    it("routes all of a judgement's tokens when it carries a cost, zero included", () => {
      expect(instantEvalJudgementRoutedSpendOf({ inputTokens: 500 })).toBeUndefined();
      expect(instantEvalJudgementRoutedSpendOf({ inputTokens: 500, costNanoUsd: 0 })).toEqual({
        costNanoUsd: 0,
        routedInputTokens: 500,
      });
    });
  });
});
