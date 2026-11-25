/**
 * Doubleword catalog ids keep the vendor's own slash, and a span naming one is priced at
 * Doubleword's realtime rate from the catalog.
 * @see specs/model-providers/doubleword-provider.feature
 */
import { describe, expect, it } from "vitest";

import { findMatchingModelCost } from "../../model-cost.ts";
import { llmModels } from "../model-catalog.ts";
import { getStaticModelCostRates } from "../static-model-costs.ts";

describe("Doubleword catalog pricing", () => {
  const costs = getStaticModelCostRates();

  describe("when a span names a Doubleword model with its vendor slash", () => {
    /** @scenario A Doubleword call is priced from the catalog */
    it("prices it at Doubleword's realtime rate for that model", () => {
      const modelId = "doubleword/deepseek-ai/DeepSeek-V4.1-Flash";
      const catalogPricing = llmModels.models[modelId]?.pricing;
      expect(catalogPricing?.inputCostPerToken).toBeGreaterThan(0);

      const [match] = findMatchingModelCost(modelId, costs);

      expect(match?.model).toBe(modelId);
      expect(match?.inputCostPerToken).toBe(catalogPricing?.inputCostPerToken);
      expect(match?.outputCostPerToken).toBe(catalogPricing?.outputCostPerToken);
    });
  });
});
