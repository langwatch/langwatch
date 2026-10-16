import { getVariablePriceRouterIds } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { computeSpanCost } from "../trace-span-cost-matching.rules.ts";

const routerIds = getVariablePriceRouterIds();

describe("given a span whose model is a router the catalog prices at -1 per token", () => {
  it("has routers to check", () => {
    expect(routerIds.length).toBeGreaterThan(0);
  });

  describe("when the span is costed from the registry", () => {
    /** @scenario A span through a router is never costed below zero */
    it.each(routerIds)("never costs %s below zero, nor at another model's price", (model) => {
      expect(
        computeSpanCost({
          attrs: {},
          model,
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
        }),
      ).toBe(0);
    });
  });
});

describe("given a span whose model the catalog prices", () => {
  it("costs it above zero", () => {
    expect(
      computeSpanCost({
        attrs: {},
        model: "openai/gpt-5-mini",
        promptTokens: 1000,
        completionTokens: 1000,
      }),
    ).toBeGreaterThan(0);
  });
});
