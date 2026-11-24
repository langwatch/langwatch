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
  pickInstantEvalRatedSpend,
  instantEvalSpentPriceUsd,
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

describe("given the published rates (ADR-174 decision 25)", () => {
  describe("when the published rate of a spend is chosen", () => {
    /** @scenario "Only spend a backend past Jev answered has a published rate" */
    it("has none when no input token is rated, whoever asked", () => {
      for (const caller of ["instant_eval", "llm_judge"] as const) {
        expect(pickInstantEvalRatedSpend({ caller, ratedInputTokens: undefined })).toBeUndefined();
        expect(pickInstantEvalRatedSpend({ caller, ratedInputTokens: 0 })).toBeUndefined();
      }
    });

    /** @scenario "Only spend a backend past Jev answered has a published rate" */
    it("is Instant for Instant Evals and Evals for an LLM judge, on the rated tokens", () => {
      expect(pickInstantEvalRatedSpend({ caller: "instant_eval", ratedInputTokens: 40 })).toEqual({
        tier: "instant",
        inputTokens: 40,
      });
      expect(pickInstantEvalRatedSpend({ caller: "llm_judge", ratedInputTokens: 40 })).toEqual({
        tier: "evals",
        inputTokens: 40,
      });
    });
  });

  describe("when an unrouted call is priced", () => {
    /** @scenario "An unrouted call is priced at the cost times 1.3, with no published rate" */
    it("is the cost times 1.3 for a run and for an LLM judge on Instant Preview", () => {
      const runCostUsd = instantEvalCostUsd({ inputTokens: 1_000_000 });
      const judgeCostUsd = instantEvalCostUsd({ inputTokens: 500 });

      expect(runCostUsd).toBe(0.042);
      expect(judgeCostUsd).toBe(0.000021);
      for (const caller of ["instant_eval", "llm_judge"] as const) {
        const rated = pickInstantEvalRatedSpend({ caller, ratedInputTokens: undefined });
        expect(instantEvalPriceUsd({ costUsd: runCostUsd, rated })).toBe(0.0546);
        expect(instantEvalPriceUsd({ costUsd: judgeCostUsd, rated })).toBe(0.0000273);
      }
    });
  });

  describe("when Instant Evals spend past Jev rates one million input tokens", () => {
    /** @scenario "Instant Evals spend past Jev is priced at 0.30 USD per million input tokens" */
    it("is 0.30 USD when its summed cost times 1.3 is below the rate", () => {
      const rated = pickInstantEvalRatedSpend({
        caller: "instant_eval",
        ratedInputTokens: 1_000_000,
      });

      expect(INSTANT_EVAL_PUBLISHED_RATES.instant).toBe(0.3);
      expect(
        instantEvalSpentPriceUsd({
          inputTokens: 1_000_000,
          costNanoUsd: 100_000_000,
          routedInputTokens: 1_000_000,
          rated,
        }),
      ).toBe(0.3);
    });
  });

  describe("when an LLM judge routed through Evals Preview rates one million input tokens", () => {
    /** @scenario "An LLM judge routed through Evals Preview is priced at 0.60 USD per million input tokens" */
    it("is 0.60 USD when its summed cost times 1.3 is below the rate", () => {
      const rated = pickInstantEvalRatedSpend({ caller: "llm_judge", ratedInputTokens: 1_000_000 });

      expect(INSTANT_EVAL_PUBLISHED_RATES.evals).toBe(0.6);
      expect(
        instantEvalSpentPriceUsd({
          inputTokens: 1_000_000,
          costNanoUsd: 200_000_000,
          routedInputTokens: 1_000_000,
          rated,
        }),
      ).toBe(0.6);
    });
  });

  describe("when a routed call's cost times 1.3 is above the rate", () => {
    /** @scenario "A routed call whose cost times 1.3 is above the rate is priced at that floor" */
    it("prices the call at the floor, on either tier", () => {
      expect(
        instantEvalPriceUsd({ costUsd: 0.5, rated: { tier: "evals", inputTokens: 1_000_000 } }),
      ).toBe(0.65);
      expect(
        instantEvalPriceUsd({ costUsd: 0.25, rated: { tier: "instant", inputTokens: 1_000_000 } }),
      ).toBe(0.325);
    });
  });

  describe("when a routed call read the row more than once", () => {
    /** @scenario "The published rate applies to the row's input tokens once" */
    it("rates the row's 2,000 input tokens once, and takes the floor from every paid leg", () => {
      const rated = { tier: "evals", inputTokens: 2_000 } as const;
      const legs = { inputTokens: 3_260, routedInputTokens: 3_260, rated };

      // Cheap legs: 2,000 tokens at 0.60 USD per million, not the 3,260 the legs summed.
      expect(instantEvalSpentPriceUsd({ ...legs, costNanoUsd: 300_000 })).toBe(0.0012);
      // Dear legs: their summed cost times 1.3 is above the rate.
      expect(instantEvalSpentPriceUsd({ ...legs, costNanoUsd: 2_460_000 })).toBe(0.003198);
    });
  });

  describe("when a routed call's cost includes output tokens", () => {
    /** @scenario "Output tokens are free" */
    it("prices only the input tokens at the rate", () => {
      expect(
        instantEvalSpentPriceUsd({
          inputTokens: 1_000_000,
          costNanoUsd: 200_000_000,
          routedInputTokens: 1_000_000,
          rated: { tier: "evals", inputTokens: 1_000_000 },
        }),
      ).toBe(0.6);
    });
  });

  describe("when the rate version is stamped", () => {
    /** @scenario "The rate version names a published rate only when one priced the spend" */
    it("keeps the old stamps without a published rate and names the tier's rate with one", () => {
      expect(instantEvalRateVersion()).toBe("instant_eval@0.042x1.3");
      const routePricing = INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING;
      expect(instantEvalJudgeRouteRateVersion({ routePricing })).toBe(
        "instant_eval_judge_router@defaultx1.3",
      );
      expect(instantEvalJudgeRouteRateVersion({ routePricing, tier: "instant" })).toBe(
        "instant_eval_judge_router@instant0.3+defaultx1.3",
      );
      expect(instantEvalJudgeRouteRateVersion({ routePricing, tier: "evals" })).toBe(
        "instant_eval_judge_router@evals0.6+defaultx1.3",
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

    /** @scenario "Only spend a backend past Jev answered has a published rate" */
    it("carries a judgement's rated tokens beside its routed part", () => {
      expect(
        pickInstantEvalJudgementRoutedSpend({
          inputTokens: 3_260,
          costNanoUsd: 300_000,
          ratedInputTokens: 2_000,
        }),
      ).toEqual({ costNanoUsd: 300_000, routedInputTokens: 3_260, ratedInputTokens: 2_000 });
    });
  });
});
