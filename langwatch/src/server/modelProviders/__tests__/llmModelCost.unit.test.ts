import { describe, expect, it } from "vitest";
import { getStaticModelCosts } from "../llmModelCost";

// getStaticModelCosts reads llmModels.json and builds regex patterns.
// These tests verify the regex generation produces patterns that actually
// match the model strings we receive from real integrations.

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
        "anthropic/claude-opus-4.5",
        "anthropic/claude-opus-4.6",
        "deepseek/deepseek-v3.2",
        "minimax/minimax-m2.1",
      ];
      for (const model of expectedModels) {
        expect(findByModel(model), `${model} missing from registry`).toBeDefined();
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
      expect(matches("anthropic/claude-opus-4.5", "anthropic/claude-opus-4.5")).toBe(true);
    });

    it("matches anthropic/claude-opus-4.5 without the vendor prefix", () => {
      expect(matches("anthropic/claude-opus-4.5", "claude-opus-4.5")).toBe(true);
    });

    it("does not match openai/gpt-4o against a different model", () => {
      expect(matches("openai/gpt-4o", "gpt-4o-mini")).toBe(false);
    });
  });

  describe("dot/hyphen interchangeability in version numbers", () => {
    it("matches claude-opus-4.5 when sent with a hyphen separator", () => {
      // Providers sometimes send "claude-opus-4-5" instead of "claude-opus-4.5"
      expect(matches("anthropic/claude-opus-4.5", "claude-opus-4-5")).toBe(true);
    });

    it("matches claude-opus-4.6 when sent with a hyphen separator", () => {
      expect(matches("anthropic/claude-opus-4.6", "claude-opus-4-6")).toBe(true);
    });

    it("matches minimax-m2.1 when sent with a hyphen separator", () => {
      expect(matches("minimax/minimax-m2.1", "minimax-m2-1")).toBe(true);
    });

    it("matches deepseek-v3.2 when sent with a hyphen separator", () => {
      expect(matches("deepseek/deepseek-v3.2", "deepseek-v3-2")).toBe(true);
    });
  });

  describe("regex does not allow overly broad matches", () => {
    it("does not match a model that only shares a prefix", () => {
      expect(matches("openai/gpt-4o", "gpt-4o-turbo")).toBe(false);
    });

    it("does not match a model that only shares a suffix", () => {
      expect(matches("openai/gpt-4o", "my-custom-gpt-4o")).toBe(false);
    });
  });
});
