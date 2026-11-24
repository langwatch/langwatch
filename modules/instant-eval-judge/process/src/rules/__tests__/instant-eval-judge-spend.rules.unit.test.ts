/**
 * One judge call's priced fact: the published rate only on rated tokens, else the cost times 1.3.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-pricing.feature
 */

import { describe, expect, it } from "vitest";

import { instantEvalJudgeSpendPricedOf } from "../instant-eval-judge-spend.rules.ts";

const SPEND = {
  organizationId: "organization-1",
  projectId: "project-1",
  requestId: "request-1",
  occurredAt: 1_700_000_000_000,
  caller: "llm_judge",
} as const;
const ROUTE_PRICING = { version: "test", backends: {} };

describe("given an LLM judge's call", () => {
  describe("when it was not routed", () => {
    /** @scenario "An unrouted call is priced at the cost times 1.3, with no published rate" */
    it("is the cost times 1.3 under the unrouted model and rate", () => {
      const { priceUsd, fact } = instantEvalJudgeSpendPricedOf({ ...SPEND, inputTokens: 500 });

      expect(priceUsd).toBe(0.0000273);
      expect(fact).toMatchObject({
        model: "langwatch-instant-preview",
        rateVersion: "instant_eval@0.042x1.3",
        costNanoUsd: 21_000,
        priceNanoUsd: 27_300,
      });
    });
  });

  describe("when it was routed and only Jev answered", () => {
    /** @scenario "A routed call no backend past Jev answered is priced at the cost times 1.3" */
    it("is the summed cost times 1.3 under the router's rate, naming no published rate", () => {
      const { fact } = instantEvalJudgeSpendPricedOf({
        ...SPEND,
        inputTokens: 1_000_000,
        routed: { costNanoUsd: 42_000_000, routedInputTokens: 1_000_000, pricing: ROUTE_PRICING },
      });

      expect(fact).toMatchObject({
        model: "langwatch-judge",
        rateVersion: "instant_eval_judge_router@testx1.3",
        costNanoUsd: 42_000_000,
        priceNanoUsd: 54_600_000,
      });
    });
  });

  describe("when a 2,000-token row escalated twice, so its legs read 3,260 tokens", () => {
    const routed = (costNanoUsd: number) => ({
      costNanoUsd,
      routedInputTokens: 3_260,
      ratedInputTokens: 2_000,
      pricing: ROUTE_PRICING,
    });

    /** @scenario "The published rate applies to the row's input tokens once" */
    it("rates the row's 2,000 tokens at Evals Preview's 0.60 USD per million, not the legs' 3,260", () => {
      const { fact } = instantEvalJudgeSpendPricedOf({
        ...SPEND,
        inputTokens: 3_260,
        routed: routed(300_000),
      });

      expect(fact).toMatchObject({
        model: "langwatch-judge",
        rateVersion: "instant_eval_judge_router@evals0.6+testx1.3",
        inputTokens: 3_260,
        costNanoUsd: 300_000,
        priceNanoUsd: 1_200_000,
      });
    });

    /** @scenario "The published rate applies to the row's input tokens once" */
    it("takes the floor from every paid leg's summed cost when that is higher", () => {
      const { fact } = instantEvalJudgeSpendPricedOf({
        ...SPEND,
        inputTokens: 3_260,
        routed: routed(2_460_000),
      });

      expect(fact).toMatchObject({ costNanoUsd: 2_460_000, priceNanoUsd: 3_198_000 });
    });
  });
});
