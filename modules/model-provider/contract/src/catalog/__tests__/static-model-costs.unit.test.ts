import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("static model cost ordering", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("../model-catalog.ts");
    vi.resetModules();
  });

  it("orders by matched model suffix rather than vendor-prefixed key length", async () => {
    vi.doMock("../model-catalog.ts", () => ({
      llmModels: {
        updatedAt: "test",
        modelCount: 2,
        models: {
          "verylongvendor/abc": {
            pricing: {
              inputCostPerToken: 0.001,
              outputCostPerToken: 0.002,
            },
          },
          "x/abc-def": {
            pricing: {
              inputCostPerToken: 0.003,
              outputCostPerToken: 0.004,
            },
          },
        },
      },
    }));

    const { getStaticModelCostRates } = await import("../static-model-costs.ts");
    const rates = getStaticModelCostRates();

    expect(rates.map((rate) => rate.model)).toEqual(["x/abc-def", "verylongvendor/abc"]);
    expect(rates.find((rate) => new RegExp(rate.regex).test("abc-def"))?.model).toBe("x/abc-def");
  });
});

describe("static model cost web search rate", () => {
  /** @scenario "the catalog carries the per-query web search rate to the cost rule" */
  it("carries the catalog's per-query web search rate onto the cost rule", async () => {
    vi.resetModules();
    const { getStaticModelCostRates } = await import("../static-model-costs.ts");
    const rule = getStaticModelCostRates().find((rate) => rate.model === "openai/gpt-5-mini");
    expect(rule?.webSearchCostPerQuery).toBe(0.01);
  });
});
