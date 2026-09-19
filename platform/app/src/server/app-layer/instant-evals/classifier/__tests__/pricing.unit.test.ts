/**
 * What a judgement costs, and what it is sold for.
 *
 * @see ../pricing.ts
 * @see specs/instant-evals/classifier.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_PRICING,
  instantEvalCostUsd,
  instantEvalPriceUsd,
} from "../pricing";

describe("given a response from the classifier", () => {
  describe("when the cost is computed", () => {
    /** @scenario "Cost is the input tokens at the published rate, and output is free" */
    /** @scenario "The cost is the tokens at the classifier's published rate" */
    it("charges the published rate for the input tokens only", () => {
      expect(instantEvalCostUsd({ inputTokens: 1_000_000 })).toBeCloseTo(
        INSTANT_EVAL_PRICING.usdPerMillionInputTokens,
        10,
      );
      // A run's whole spend is priced by this one call, so the rate has to be
      // linear in the tokens rather than charged per request.
      expect(instantEvalCostUsd({ inputTokens: 2_000_000 })).toBeCloseTo(
        INSTANT_EVAL_PRICING.usdPerMillionInputTokens * 2,
        10,
      );
    });

    it("charges nothing for a judgement that sent nothing", () => {
      expect(instantEvalCostUsd({ inputTokens: 0 })).toBe(0);
    });
  });

  describe("when the customer price is computed", () => {
    /** @scenario "The customer price carries the platform markup" */
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
