/**
 * Routers are priced by whatever model they pick, and the upstream sources mark that with -1 per
 * token. Read as a rate, -1 bills a refund: a million tokens each way through one came out at
 * -2,000,000 dollars. These pin that no cost reader takes the marker as a price.
 */
import { describe, expect, it } from "vitest";

import { findMatchingModelCost } from "../../model-cost.ts";
import type { ModelCostRate } from "../../model-provider.ts";
import { llmModels } from "../model-catalog.ts";
import { getStaticModelCostRates } from "../static-model-costs.ts";
import {
  isVariablePriceRouter,
  isVariablePriceRouterId,
  withoutNegativeRates,
} from "../variable-price-routers.ts";

const catalogRouterIds = Object.entries(llmModels.models)
  .filter(([, entry]) => isVariablePriceRouter(entry))
  .map(([id]) => id);

describe("withoutNegativeRates", () => {
  describe("given a router's pricing", () => {
    it("drops every negative rate", () => {
      expect(withoutNegativeRates({ inputCostPerToken: -1, outputCostPerToken: -1 })).toEqual({});
    });
  });

  describe("given a priced model", () => {
    it("keeps every rate, zero included", () => {
      const pricing = {
        inputCostPerToken: 0,
        outputCostPerToken: 2e-6,
        inputCacheReadPerToken: 1e-7,
      };
      expect(withoutNegativeRates(pricing)).toEqual(pricing);
    });
  });
});

describe("isVariablePriceRouter", () => {
  it("is true only when every stated rate is negative", () => {
    expect(
      isVariablePriceRouter({ pricing: { inputCostPerToken: -1, outputCostPerToken: -1 } }),
    ).toBe(true);
    expect(
      isVariablePriceRouter({ pricing: { inputCostPerToken: -1, outputCostPerToken: 1e-6 } }),
    ).toBe(false);
    expect(
      isVariablePriceRouter({ pricing: { inputCostPerToken: 0, outputCostPerToken: 0 } }),
    ).toBe(false);
  });
});

describe("given the committed catalog", () => {
  it("lists routers to check against", () => {
    expect(catalogRouterIds.length).toBeGreaterThan(0);
    expect(catalogRouterIds.every((id) => isVariablePriceRouterId(id))).toBe(true);
  });

  describe("when the cost registry is built", () => {
    /** @scenario The cost registry carries no negative rate */
    it("carries no negative rate for any model", () => {
      const negative = getStaticModelCostRates().filter((rate) =>
        Object.values(rate).some((value) => typeof value === "number" && value < 0),
      );
      expect(negative.map((rate) => rate.model)).toEqual([]);
    });

    /** @scenario A router gets no cost rule of its own */
    it("gives no router a rule of its own", () => {
      const ruled = new Set(getStaticModelCostRates().map((rate) => rate.model));
      expect(catalogRouterIds.filter((id) => ruled.has(id))).toEqual([]);
    });
  });

  describe("when a router's cost is matched", () => {
    /** @scenario A router never borrows another model's cost rule */
    it.each(catalogRouterIds)("finds no rule for %s, not even a borrowed one", (id) => {
      // `openrouter/pareto-code` prefix-matched `unbiased/pareto` and billed its price.
      expect(findMatchingModelCost(id, getStaticModelCostRates())).toEqual([]);
    });

    /** @scenario A router id in another letter case borrows no cost rule */
    it("finds no borrowed rule when the router id arrives in another letter case", () => {
      // The case-insensitive fallbacks lent `OpenRouter/Pareto-Code` the `unbiased/pareto` price.
      for (const id of catalogRouterIds.map((routerId) => routerId.toUpperCase())) {
        expect(findMatchingModelCost(id, getStaticModelCostRates())).toEqual([]);
      }
    });

    /** @scenario A cost rule that names the router still prices it */
    it("still takes a rule that names the router itself", () => {
      const [router] = catalogRouterIds;
      const own: ModelCostRate = {
        model: router!,
        regex: `^${router!.replace("/", "\\/")}$`,
        inputCostPerToken: 1e-6,
        outputCostPerToken: 2e-6,
      };
      expect(findMatchingModelCost(router!, [own, ...getStaticModelCostRates()])).toEqual([own]);
      expect(
        findMatchingModelCost(router!.toUpperCase(), [own, ...getStaticModelCostRates()]),
      ).toEqual([own]);
    });
  });
});
