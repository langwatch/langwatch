/**
 * Routers are priced by whatever model they pick, and the upstream sources mark that with -1 per
 * token. Read as a rate, -1 bills a refund: a million tokens each way through one came out at
 * -2,000,000 dollars. These pin that no cost reader takes the marker as a price.
 */
import { describe, expect, it } from "vitest";

import { findMatchingModelCost } from "../../model-cost.ts";
import type { ModelCostRate } from "../../model-provider.ts";
import { getStaticModelCostRates } from "../static-model-costs.ts";
import {
  getVariablePriceRouterIds,
  isVariablePriceRouter,
  isVariablePriceRouterId,
  withoutNegativeRates,
} from "../variable-price-routers.ts";

const catalogRouterIds = getVariablePriceRouterIds();

/** The ways a client writes a router id: letter case, a repeated provider, a variant tag. */
const clientSpellings = (id: string): string[] => [
  id.toUpperCase(),
  id.replace(/^./, (first) => first.toUpperCase()),
  `${id.slice(0, id.indexOf("/"))}/${id}`,
  `${id}:free`,
];

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

describe("isVariablePriceRouterId", () => {
  describe("given a model string a span could send, many colons before a slash", () => {
    it("answers in time linear in its length", () => {
      const started = Date.now();
      expect(isVariablePriceRouterId(`${":".repeat(200_000)}/x`)).toBe(false);
      expect(Date.now() - started).toBeLessThan(1_000);
    });
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
    // Routers whose id, past the provider prefix, matches a priced model's rule: the fallback the
    // matcher takes for any other id. `openrouter/pareto-code` borrowed `unbiased/pareto` this way.
    const borrowingRouterIds = catalogRouterIds.filter(
      (id) =>
        findMatchingModelCost(id.slice(id.indexOf("/") + 1), getStaticModelCostRates()).length > 0,
    );

    /** @scenario A router never borrows another model's cost rule */
    it("finds no rule for a router whose id prefix-matches a priced model", () => {
      expect(borrowingRouterIds.length).toBeGreaterThan(0);
      for (const id of borrowingRouterIds) {
        expect(findMatchingModelCost(id, getStaticModelCostRates())).toEqual([]);
      }
    });

    it.each(catalogRouterIds)("finds no rule for %s", (id) => {
      expect(findMatchingModelCost(id, getStaticModelCostRates())).toEqual([]);
    });

    /** @scenario A router id in a client's spelling borrows no cost rule */
    it("finds no borrowed rule when the router id arrives in a client's spelling", () => {
      expect(borrowingRouterIds.length).toBeGreaterThan(0);
      for (const id of borrowingRouterIds) {
        // LiteLLM and DSPy send `openrouter/openrouter/pareto-code`, which borrowed the price too.
        for (const spelling of clientSpellings(id)) {
          expect(findMatchingModelCost(spelling, getStaticModelCostRates())).toEqual([]);
        }
      }
    });

    it("does not read a bare name with no provider as a router", () => {
      expect(isVariablePriceRouterId("auto")).toBe(false);
    });

    /** @scenario A cost rule that names the router still prices it */
    it("still takes a project rule that names the router, in any client's spelling", () => {
      const [router] = borrowingRouterIds;
      // Written the way a project rule is typed: the plain id, unanchored and unescaped.
      const own: ModelCostRate = {
        model: router!,
        regex: router!,
        inputCostPerToken: 1e-6,
        outputCostPerToken: 2e-6,
      };
      for (const spelling of [router!, ...clientSpellings(router!)]) {
        expect(findMatchingModelCost(spelling, [own, ...getStaticModelCostRates()])).toEqual([own]);
      }
    });
  });
});
