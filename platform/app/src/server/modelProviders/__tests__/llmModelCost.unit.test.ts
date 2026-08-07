import { afterEach, describe, expect, it, vi } from "vitest";
import { getStaticModelCosts, resolveCacheWrite1hRate } from "../llmModelCost";

describe("getStaticModelCosts", () => {
  const costs = getStaticModelCosts();

  const findByModel = (modelId: string) =>
    costs.find((c) => c.model === modelId);

  const matches = (modelId: string, input: string) => {
    const entry = findByModel(modelId);
    if (!entry) throw new Error(`Model not found in registry: ${modelId}`);
    return new RegExp(entry.regex).test(input);
  };

  describe("registry integrity", () => {
    it("produces at least one cost entry", () => {
      expect(costs.length).toBeGreaterThan(0);
    });

    it("every entry has a non-empty regex", () => {
      for (const entry of costs) {
        expect(entry.regex, `${entry.model} has empty regex`).toBeTruthy();
      }
    });

    it("every regex compiles without throwing", () => {
      for (const entry of costs) {
        expect(
          () => new RegExp(entry.regex),
          `${entry.model} has invalid regex: ${entry.regex}`,
        ).not.toThrow();
      }
    });

    it("known models exist in the registry", () => {
      const expectedModels = [
        "openai/gpt-4o",
        "anthropic/claude-opus-4-5",
        "anthropic/claude-opus-4-6",
        "deepseek/deepseek-v3.2",
        "minimax/minimax-m2.1",
      ];
      for (const model of expectedModels) {
        expect(
          findByModel(model),
          `${model} missing from registry`,
        ).toBeDefined();
      }
    });
  });

  describe("vendor prefix is optional in generated regex", () => {
    it("matches openai/gpt-4o with the vendor prefix", () => {
      expect(matches("openai/gpt-4o", "openai/gpt-4o")).toBe(true);
    });

    it("matches openai/gpt-4o without the vendor prefix", () => {
      expect(matches("openai/gpt-4o", "gpt-4o")).toBe(true);
    });

    it("matches anthropic/claude-opus-4-5 with the vendor prefix", () => {
      expect(
        matches("anthropic/claude-opus-4-5", "anthropic/claude-opus-4-5"),
      ).toBe(true);
    });

    it("matches anthropic/claude-opus-4-5 without the vendor prefix", () => {
      expect(matches("anthropic/claude-opus-4-5", "claude-opus-4-5")).toBe(
        true,
      );
    });

    it("still matches longer prefixed variants, which downstream lookup disambiguates by order", () => {
      expect(matches("openai/gpt-4o", "gpt-4o-mini")).toBe(true);
    });
  });

  describe("dot/hyphen interchangeability in version numbers", () => {
    it("matches claude-opus-4-5 when sent with a dot separator", () => {
      expect(matches("anthropic/claude-opus-4-5", "claude-opus-4.5")).toBe(
        true,
      );
    });

    it("matches claude-opus-4-6 when sent with a dot separator", () => {
      expect(matches("anthropic/claude-opus-4-6", "claude-opus-4.6")).toBe(
        true,
      );
    });

    it("matches minimax-m2.1 when sent with a hyphen separator", () => {
      expect(matches("minimax/minimax-m2.1", "minimax-m2-1")).toBe(true);
    });

    it("matches deepseek-v3.2 when sent with a hyphen separator", () => {
      expect(matches("deepseek/deepseek-v3.2", "deepseek-v3-2")).toBe(true);
    });
  });

  describe("regex anchoring", () => {
    it("matches prefix variants from the start of the model string", () => {
      expect(matches("openai/gpt-4o", "gpt-4o-turbo")).toBe(true);
    });

    it("does not match a model that only shares a suffix", () => {
      expect(matches("openai/gpt-4o", "my-custom-gpt-4o")).toBe(false);
    });
  });

  describe("given model entries whose vendor-prefixed key length hides the matched suffix length", () => {
    afterEach(() => {
      vi.doUnmock("../loadModelCatalog");
      vi.resetModules();
    });

    describe("when static model costs are built", () => {
      it("orders entries by matched model suffix, not vendor-prefixed key length", async () => {
        vi.resetModules();
        vi.doMock("../loadModelCatalog", () => ({
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

        const { getStaticModelCosts: getMockedStaticModelCosts } = await import(
          "../llmModelCost"
        );
        const mockedCosts = getMockedStaticModelCosts();

        expect(mockedCosts.map((entry) => entry.model)).toEqual([
          "x/abc-def",
          "verylongvendor/abc",
        ]);
        expect(
          mockedCosts.find((entry) => new RegExp(entry.regex).test("abc-def"))
            ?.model,
        ).toBe("x/abc-def");
      });
    });
  });
});

/**
 * Anthropic keeps a prompt-cache entry for five minutes at 1.25x the input rate
 * or for an hour at 2x, and publishes only the five-minute figure. The catalog
 * carries that one figure, so the hour-long rate is derived at load time. These
 * pin the derivation against Anthropic's published pricing; if a registry sync
 * changes the underlying numbers, re-check the pricing page before updating.
 */
describe("hour-long cache write rate", () => {
  const costs = getStaticModelCosts();
  const byModel = (modelId: string) => costs.find((c) => c.model === modelId);

  describe("given the catalog carries no hour-long price", () => {
    /** @scenario "An hour-long cache write rate is derived for Anthropic models" */
    it("prices an hour-long Anthropic cache write at twice the input rate", () => {
      const opus = byModel("anthropic/claude-opus-5");
      expect(opus?.inputCostPerToken).toBe(0.000005);
      // The catalog's single cache write price is the five-minute one.
      expect(opus?.cacheCreationCostPerToken).toBe(0.00000625);
      expect(opus?.cacheCreation1hCostPerToken).toBe(0.00001);
    });

    /** @scenario "An hour-long cache write rate is derived for Anthropic models" */
    it("derives it across the Anthropic family, aliases included", () => {
      const anthropic = costs.filter(
        (c) =>
          /^~?anthropic\//.test(c.model) && c.cacheCreationCostPerToken != null,
      );
      expect(anthropic.length).toBeGreaterThan(0);
      for (const entry of anthropic) {
        expect(
          entry.cacheCreation1hCostPerToken,
          `${entry.model} has no hour-long rate`,
        ).toBeCloseTo((entry.inputCostPerToken ?? 0) * 2, 12);
      }
      // The tilde-prefixed aliases are Anthropic too, and would be missed by a
      // plain prefix check.
      const aliases = anthropic.filter((c) =>
        c.model.startsWith("~anthropic/"),
      );
      expect(aliases.length).toBeGreaterThan(0);
    });

    /** @scenario "An hour-long cache write rate is derived for Anthropic models" */
    it("leaves models from other providers without one", () => {
      const others = costs.filter(
        (c) =>
          !/^~?anthropic\//.test(c.model) &&
          c.cacheCreation1hCostPerToken !== undefined,
      );
      expect(others).toEqual([]);
    });
  });
});

describe("resolveCacheWrite1hRate", () => {
  const ANTHROPIC = "anthropic/claude-opus-5";

  describe("given the catalog carries its own hour-long price", () => {
    /** @scenario "A catalog that learns the real rate overrides the derived one" */
    it("uses the catalog price rather than deriving one", () => {
      expect(
        resolveCacheWrite1hRate(ANTHROPIC, {
          inputCostPerToken: 0.000005,
          inputCacheWritePerToken: 0.00000625,
          inputCacheWrite1hPerToken: 0.000009,
        }),
      ).toBe(0.000009);
    });

    /** @scenario "A catalog that learns the real rate overrides the derived one" */
    it("uses it for a provider that would otherwise get nothing", () => {
      expect(
        resolveCacheWrite1hRate("openai/gpt-5", {
          inputCostPerToken: 0.000001,
          inputCacheWritePerToken: 0.00000125,
          inputCacheWrite1hPerToken: 0.000002,
        }),
      ).toBe(0.000002);
    });
  });

  describe("given the catalog carries no hour-long price", () => {
    /** @scenario "An hour-long cache write rate is derived for Anthropic models" */
    it("derives twice the input rate for an Anthropic model", () => {
      expect(
        resolveCacheWrite1hRate(ANTHROPIC, {
          inputCostPerToken: 0.000005,
          inputCacheWritePerToken: 0.00000625,
        }),
      ).toBe(0.00001);
    });

    /** @scenario "An hour-long cache write rate is derived for Anthropic models" */
    it("derives it for a tilde-prefixed Anthropic alias", () => {
      expect(
        resolveCacheWrite1hRate("~anthropic/claude-opus-5-latest", {
          inputCostPerToken: 0.000005,
          inputCacheWritePerToken: 0.00000625,
        }),
      ).toBe(0.00001);
    });

    /** @scenario "An hour-long cache write rate is derived for Anthropic models" */
    it("derives nothing for another provider", () => {
      expect(
        resolveCacheWrite1hRate("openai/gpt-5", {
          inputCostPerToken: 0.000001,
          inputCacheWritePerToken: 0.00000125,
        }),
      ).toBeUndefined();
    });

    /** @scenario "An hour-long cache write rate is derived for Anthropic models" */
    it("derives nothing for a model that is not cache-priced at all", () => {
      expect(
        resolveCacheWrite1hRate(ANTHROPIC, { inputCostPerToken: 0.000005 }),
      ).toBeUndefined();
    });
  });
});
