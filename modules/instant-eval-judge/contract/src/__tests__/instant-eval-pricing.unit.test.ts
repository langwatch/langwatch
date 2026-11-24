/**
 * What a judgement costs us, and what it is sold for.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-pricing.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
  INSTANT_EVAL_PRICING,
  INSTANT_EVAL_PUBLISHED_RATES,
  instantEvalCostUsd,
  instantEvalJudgeRouteRateVersion,
  pickInstantEvalJudgementRoutedSpend,
  instantEvalPriceUsd,
  instantEvalRateVersion,
  instantEvalSpentPriceUsd,
  instantEvalTierOf,
  pickInstantEvalRoutedSpend,
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
    /** @scenario "The customer price is the published rate, never below the cost times the markup" */
    it("is the tokens at the tier's rate, or the cost times the markup when that is higher", () => {
      const costUsd = instantEvalCostUsd({ inputTokens: 2_000_000 });

      expect(instantEvalPriceUsd({ costUsd, inputTokens: 2_000_000, tier: "instant" })).toBe(0.6);
      expect(instantEvalPriceUsd({ costUsd: 1, inputTokens: 2_000_000, tier: "instant" })).toBe(
        INSTANT_EVAL_PRICING.markup,
      );
    });
  });
});

describe("given the published rates (ADR-174 decision 25)", () => {
  describe("when the tier of a spend is chosen", () => {
    const routed = { costNanoUsd: 0, routedInputTokens: 1 };

    /** @scenario "The tier follows the product model, not the routed flag alone" */
    it("is Instant for Instant Evals, routed or not, and for an unrouted LLM judge", () => {
      expect(instantEvalTierOf({ caller: "instant_eval", routed: undefined })).toBe("instant");
      expect(instantEvalTierOf({ caller: "instant_eval", routed })).toBe("instant");
      expect(instantEvalTierOf({ caller: "llm_judge", routed: undefined })).toBe("instant");
    });

    /** @scenario "The tier follows the product model, not the routed flag alone" */
    it("is Evals only for an LLM judge routed through Evals Preview", () => {
      expect(instantEvalTierOf({ caller: "llm_judge", routed })).toBe("evals");
    });
  });

  describe("when Instant Evals or an unrouted LLM judge reads one million input tokens", () => {
    /** @scenario "Instant Evals and an LLM judge on Instant Preview are priced at 0.30 USD per million input tokens" */
    it("is 0.30 USD, not the cost times 1.3", () => {
      const costUsd = instantEvalCostUsd({ inputTokens: 1_000_000 });

      expect(costUsd).toBe(0.042);
      expect(INSTANT_EVAL_PUBLISHED_RATES.instant).toBe(0.3);
      for (const caller of ["instant_eval", "llm_judge"] as const) {
        const tier = instantEvalTierOf({ caller, routed: undefined });
        expect(instantEvalPriceUsd({ costUsd, inputTokens: 1_000_000, tier })).toBe(0.3);
      }
    });
  });

  describe("when a routed Instant Evals run reads one million input tokens", () => {
    /** @scenario "A routed Instant Evals run stays at 0.30 USD per million input tokens" */
    it("is 0.30 USD, not Evals Preview's rate", () => {
      const spent = {
        inputTokens: 1_000_000,
        costNanoUsd: 5_000_000,
        routedInputTokens: 1_000_000,
      };
      const tier = instantEvalTierOf({ caller: "instant_eval", routed: spent });

      expect(instantEvalSpentPriceUsd({ ...spent, tier })).toBe(0.3);
    });
  });

  describe("when an LLM judge routed through Evals Preview reads one million input tokens", () => {
    /** @scenario "An LLM judge routed through Evals Preview is priced at 0.60 USD per million input tokens" */
    it("is 0.60 USD", () => {
      const spent = {
        inputTokens: 1_000_000,
        costNanoUsd: 42_000_000,
        routedInputTokens: 1_000_000,
      };
      const tier = instantEvalTierOf({ caller: "llm_judge", routed: spent });

      expect(INSTANT_EVAL_PUBLISHED_RATES.evals).toBe(0.6);
      expect(instantEvalSpentPriceUsd({ ...spent, tier })).toBe(0.6);
    });
  });

  describe("when the cost times 1.3 is above the rate", () => {
    /** @scenario "A call whose cost times 1.3 is above the rate is priced at that floor" */
    it("prices the call at the floor, on either tier", () => {
      expect(instantEvalPriceUsd({ costUsd: 0.5, inputTokens: 1_000_000, tier: "evals" })).toBe(
        0.65,
      );
      expect(instantEvalPriceUsd({ costUsd: 0.25, inputTokens: 1_000_000, tier: "instant" })).toBe(
        0.325,
      );
    });

    /** @scenario "A call whose cost times 1.3 is above the rate is priced at that floor" */
    it("prices a routed spend from its summed cost at the floor", () => {
      expect(
        instantEvalSpentPriceUsd({
          inputTokens: 1_000_000,
          costNanoUsd: 500_000_000,
          routedInputTokens: 1_000_000,
          tier: "evals",
        }),
      ).toBe(0.65);
    });
  });

  describe("when a routed call's cost includes output tokens", () => {
    /** @scenario "Output tokens are free at the published rate" */
    it("prices only the input tokens at the rate", () => {
      expect(
        instantEvalSpentPriceUsd({
          inputTokens: 1_000_000,
          costNanoUsd: 200_000_000,
          routedInputTokens: 1_000_000,
          tier: "evals",
        }),
      ).toBe(0.6);
    });
  });

  describe("when the rate version is stamped", () => {
    /** @scenario "The rate version names the tier's rate and the floor" */
    it("names the tier, its rate and the floor's rate and markup", () => {
      expect(instantEvalRateVersion({ tier: "instant" })).toBe("instant_eval@instant0.3+0.042x1.3");
      expect(instantEvalRateVersion({ tier: "evals" })).toBe("instant_eval@evals0.6+0.042x1.3");
      expect(
        instantEvalJudgeRouteRateVersion({
          routePricing: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
          tier: "evals",
        }),
      ).toBe("instant_eval_judge_router@evals0.6+defaultx1.3");
    });
  });
});

describe("given a judgement whose raw product carries float noise", () => {
  describe("when its cost and price are computed", () => {
    /** @scenario "A priced amount is rounded to nano-USD precision" */
    it("rounds both to the ledger's nano-USD unit", () => {
      const costUsd = instantEvalCostUsd({ inputTokens: 211_727 });
      const priceUsd = instantEvalPriceUsd({ costUsd, inputTokens: 211_727, tier: "instant" });

      expect(costUsd).toBe(0.008892534);
      expect(priceUsd).toBe(0.0635181);
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
      expect(pickInstantEvalRoutedSpend({})).toBeUndefined();
      expect(pickInstantEvalRoutedSpend({ costNanoUsd: 0, routedInputTokens: 0 })).toBeUndefined();
      // A backend that bills output tokens alone has a cost and no routed input tokens.
      expect(pickInstantEvalRoutedSpend({ costNanoUsd: 5000, routedInputTokens: 0 })).toEqual({
        costNanoUsd: 5000,
        routedInputTokens: 0,
      });
      expect(pickInstantEvalRoutedSpend({ costNanoUsd: 0, routedInputTokens: 40 })).toEqual({
        costNanoUsd: 0,
        routedInputTokens: 40,
      });
    });

    /** @scenario "A routed judgement with a cost of zero is still routed" */
    it("routes all of a judgement's tokens when it carries a cost, zero included", () => {
      expect(pickInstantEvalJudgementRoutedSpend({ inputTokens: 500 })).toBeUndefined();
      expect(pickInstantEvalJudgementRoutedSpend({ inputTokens: 500, costNanoUsd: 0 })).toEqual({
        costNanoUsd: 0,
        routedInputTokens: 500,
      });
    });
  });
});
