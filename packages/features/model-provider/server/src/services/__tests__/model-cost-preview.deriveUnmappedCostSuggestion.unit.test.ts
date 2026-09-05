/**
 * See specs/traces-v2/span-unmapped-cost-suggestion.feature.
 */
import { describe, expect, it } from "vitest";
import type { ModelCost, ModelCostRate } from "@langwatch/model-provider-contract";
import { ModelCostPreviewService, type ModelCostRuleReader } from "../model-cost-preview.service";
import { ModelCostRegexSafetyService } from "../model-cost-regex-safety.service";

const preview = ModelCostPreviewService.create({
  regexSafety: ModelCostRegexSafetyService.create(),
});

function fakeCosts({
  stored = [],
  static: staticRates = [],
}: {
  stored?: ModelCost[];
  static?: ModelCostRate[];
} = {}): ModelCostRuleReader {
  return {
    listCosts: async () => stored,
    staticCostRates: () => staticRates,
  };
}

describe("ModelCostPreviewService.tryDeriveUnmappedCostSuggestion", () => {
  describe("given a span whose cost was already computed", () => {
    /** @scenario Span with a computed cost shows no suggestion */
    it("returns null when a cost was already computed", async () => {
      const suggestion = await preview.tryDeriveUnmappedCostSuggestion({
        costs: fakeCosts(),
        projectId: "proj-1",
        model: "acme-internal-llm",
        cost: 0.01,
        promptTokens: 100,
        completionTokens: 10,
      });

      expect(suggestion).toBeNull();
    });
  });

  describe("given a span with no token usage recorded", () => {
    /** @scenario Span without token counts shows no suggestion */
    it("returns null when the span has no token usage", async () => {
      const suggestion = await preview.tryDeriveUnmappedCostSuggestion({
        costs: fakeCosts(),
        projectId: "proj-1",
        model: "acme-internal-llm",
        cost: null,
        promptTokens: null,
        completionTokens: 0,
      });

      expect(suggestion).toBeNull();
    });
  });
});
