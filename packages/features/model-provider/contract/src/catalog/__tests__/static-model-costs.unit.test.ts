import { afterEach, describe, expect, it, vi } from "vitest";

describe("static model cost ordering", () => {
  afterEach(() => {
    vi.doUnmock("../model-catalog");
    vi.resetModules();
  });

  it("orders by matched model suffix rather than vendor-prefixed key length", async () => {
    vi.doMock("../model-catalog", () => ({
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

    const { getStaticModelCostRates } = await import("../static-model-costs");
    const rates = getStaticModelCostRates();

    expect(rates.map((rate) => rate.model)).toEqual(["x/abc-def", "verylongvendor/abc"]);
    expect(rates.find((rate) => new RegExp(rate.regex).test("abc-def"))?.model).toBe(
      "x/abc-def",
    );
  });
});
