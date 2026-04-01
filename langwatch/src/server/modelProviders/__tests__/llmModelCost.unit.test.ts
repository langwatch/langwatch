import { afterEach, describe, expect, it, vi } from "vitest";
import { getStaticModelCosts } from "../llmModelCost";

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
          `${entry.model} has invalid regex: ${entry.regex}`
        ).not.toThrow();
      }
    });

    it("known models exist in the registry", () => {
      const expectedModels = [
        "openai/gpt-4o",
        "anthropic/claude-opus-4.5",
        "anthropic/claude-opus-4.6",
        "deepseek/deepseek-v3.2",
        "minimax/minimax-m2.1",
      ];
      for (const model of expectedModels) {
        expect(
          findByModel(model),
          `${model} missing from registry`
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

    it("matches anthropic/claude-opus-4.5 with the vendor prefix", () => {
      expect(
        matches("anthropic/claude-opus-4.5", "anthropic/claude-opus-4.5")
      ).toBe(true);
    });

    it("matches anthropic/claude-opus-4.5 without the vendor prefix", () => {
      expect(matches("anthropic/claude-opus-4.5", "claude-opus-4.5")).toBe(
        true
      );
    });

    it("still matches longer prefixed variants, which downstream lookup disambiguates by order", () => {
      expect(matches("openai/gpt-4o", "gpt-4o-mini")).toBe(true);
    });
  });

  describe("dot/hyphen interchangeability in version numbers", () => {
    it("matches claude-opus-4.5 when sent with a hyphen separator", () => {
      expect(matches("anthropic/claude-opus-4.5", "claude-opus-4-5")).toBe(
        true
      );
    });

    it("matches claude-opus-4.6 when sent with a hyphen separator", () => {
      expect(matches("anthropic/claude-opus-4.6", "claude-opus-4-6")).toBe(
        true
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

  describe("sorting by specificity", () => {
    afterEach(() => {
      vi.doUnmock("../llmModels.json");
      vi.resetModules();
    });

    it("orders entries by matched model suffix, not vendor-prefixed key length", async () => {
      vi.resetModules();
      vi.doMock("../llmModels.json", () => ({
        default: {
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
        mockedCosts.find((entry) => new RegExp(entry.regex).test("abc-def"))?.model
      ).toBe("x/abc-def");
    });
  });
});
