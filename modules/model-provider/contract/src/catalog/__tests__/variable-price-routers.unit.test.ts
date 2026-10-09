/**
 * A router picks another model per request and has no rate of its own; the
 * upstream catalog marks it with -1 per token. Read as a price, that bills a
 * routed call below zero, so a negative rate must never reach the registry.
 * @see specs/trace-processing/catalog-router-cost.feature
 */
import { describe, expect, it } from "vitest";

import { estimateModelCost, findMatchingModelCost } from "../../model-cost.ts";
import { llmModels } from "../model-catalog.ts";
import { getStaticModelCostRates, withoutNegativeRates } from "../static-model-costs.ts";

/** Every model id the merged catalog prices as a router: all its stated rates are negative. */
const VARIABLE_PRICE_ROUTERS = Object.entries(llmModels.models)
  .filter(([, entry]) => {
    const rates = Object.values(entry.pricing ?? {}).filter(
      (rate): rate is number => typeof rate === "number",
    );
    return rates.length > 0 && rates.every((rate) => rate < 0);
  })
  .map(([modelId]) => modelId)
  .toSorted();

describe("variable-price routers", () => {
  const costs = getStaticModelCostRates();

  describe("when the catalog prices a router at -1 per token", () => {
    /** @scenario A catalog rate below zero is not used as a price */
    it("still has routers in the catalog to guard against", () => {
      // The precondition every router test rests on. If a sync stops
      // publishing a negative price for routers, these guards can be retired
      // rather than left passing on nothing.
      expect(VARIABLE_PRICE_ROUTERS).toContain("nvidia/switchyard");
      expect(llmModels.models["nvidia/switchyard"]?.pricing?.inputCostPerToken).toBeLessThan(0);
    });

    /** @scenario A catalog rate below zero is not used as a price */
    it("keeps every negative rate out of the cost registry", () => {
      // Every numeric field on a registry entry is a rate, so reading the
      // entry's own values covers a rate field added later as well.
      const negative = costs.flatMap((entry) =>
        Object.entries(entry)
          .filter(([, rate]) => typeof rate === "number" && rate < 0)
          .map(([field]) => `${entry.model}.${field}`),
      );
      expect(negative).toEqual([]);
    });

    /** @scenario A catalog rate below zero is not used as a price */
    it("leaves the router out of the registry", () => {
      expect(costs.filter((entry) => VARIABLE_PRICE_ROUTERS.includes(entry.model))).toEqual([]);
    });

    /** @scenario A router name matches no registry price */
    it("matches no registry entry for a router span", () => {
      expect(findMatchingModelCost("nvidia/switchyard", costs)[0]).toBeUndefined();
    });

    /** @scenario An evaluation cell run on a router is never costed below zero */
    it.each(VARIABLE_PRICE_ROUTERS)("never estimates %s below zero", (model) => {
      const cost = estimateModelCost(
        { attrs: {}, model, promptTokens: 1000, completionTokens: 500 },
        costs,
      );
      expect(cost).toBeGreaterThanOrEqual(0);
    });
  });

  describe("when a catalog entry states one negative rate beside real prices", () => {
    /** @scenario A single negative rate beside real prices drops only that rate */
    it("keeps the real prices and drops only the negative one", () => {
      const pricing = withoutNegativeRates({
        inputCostPerToken: 0.000001,
        outputCostPerToken: 0.000002,
        inputCacheReadPerToken: -1,
      });

      expect(pricing).toEqual({ inputCostPerToken: 0.000001, outputCostPerToken: 0.000002 });
      expect(pricing).not.toHaveProperty("inputCacheReadPerToken");
    });
  });
});

describe("hour-long cache write rate", () => {
  const costs = getStaticModelCostRates();

  describe("given another provider's catalog entry states an hour-long price", () => {
    /** @scenario "A catalog that learns the real rate overrides the derived one" */
    it("carries exactly the price the catalog states", () => {
      const stated = costs.filter(
        (c) =>
          !/^~?anthropic\//.test(c.model) &&
          llmModels.models[c.model]?.pricing?.inputCacheWrite1hPerToken != null,
      );
      expect(stated.length).toBeGreaterThan(0);
      for (const entry of stated) {
        expect(entry.cacheCreation1hCostPerToken, entry.model).toBe(
          llmModels.models[entry.model]?.pricing?.inputCacheWrite1hPerToken,
        );
      }
    });
  });

  describe("given a provider whose catalog entry states no hour-long price", () => {
    it("derives one for Anthropic only", () => {
      const others = costs.filter(
        (c) =>
          !/^~?anthropic\//.test(c.model) &&
          llmModels.models[c.model]?.pricing?.inputCacheWrite1hPerToken == null &&
          c.cacheCreation1hCostPerToken !== undefined,
      );
      expect(others).toEqual([]);
    });
  });
});

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
