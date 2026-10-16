import { isVariablePriceRouter, VARIABLE_PRICE_MARKER } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { toCatalogPricing } from "../openrouter-pricing.rules.ts";

describe("toCatalogPricing", () => {
  describe("given a priced model", () => {
    it("parses the string rates and keeps only the positive optional ones", () => {
      expect(
        toCatalogPricing({
          pricing: { prompt: "0.000001", completion: "0.000002", inputCacheRead: "0", image: "-1" },
          raw: { input_cache_write_1h: "0.000004" },
        }),
      ).toEqual({
        inputCostPerToken: 1e-6,
        outputCostPerToken: 2e-6,
        inputCacheWrite1hPerToken: 4e-6,
      });
    });
  });

  describe("given a router OpenRouter prices at -1 per token", () => {
    /** @scenario A negative OpenRouter price becomes the router marker */
    it("writes the router marker, which the catalog reads as a router", () => {
      const pricing = toCatalogPricing({ pricing: { prompt: "-1", completion: "-1" } });
      expect(pricing).toEqual({
        inputCostPerToken: VARIABLE_PRICE_MARKER,
        outputCostPerToken: VARIABLE_PRICE_MARKER,
      });
      expect(isVariablePriceRouter({ pricing })).toBe(true);
    });

    it("writes any other negative price as the same marker", () => {
      const pricing = toCatalogPricing({ pricing: { prompt: "-0.5", completion: "-2" } });
      expect(pricing.inputCostPerToken).toBe(VARIABLE_PRICE_MARKER);
      expect(pricing.outputCostPerToken).toBe(VARIABLE_PRICE_MARKER);
    });
  });

  describe("given a model with no stated price", () => {
    /** @scenario A model with no stated price is not a router */
    it("writes zero, which is not a router", () => {
      const pricing = toCatalogPricing({ pricing: { prompt: "", completion: "" } });
      expect(pricing).toEqual({ inputCostPerToken: 0, outputCostPerToken: 0 });
      expect(isVariablePriceRouter({ pricing })).toBe(false);
    });
  });
});
