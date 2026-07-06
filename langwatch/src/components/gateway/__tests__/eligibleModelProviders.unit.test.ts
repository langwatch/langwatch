import { describe, expect, it } from "vitest";

import {
  firstEligibleDefaultModel,
  type OrgModelProvider,
  resolveProviderDefaultModel,
} from "../eligibleModelProviders";

describe("resolveProviderDefaultModel", () => {
  describe("when the provider is a self-hosted custom endpoint", () => {
    it("uses the first custom model in resolver-safe vendor/model form", () => {
      expect(
        resolveProviderDefaultModel(
          "custom",
          "Custom",
          [],
          [{ modelId: "Qwen2.5-0.5B-Instruct" }],
        ),
      ).toBe("custom/Qwen2.5-0.5B-Instruct");
    });

    it("does not fall back to the OpenAI-only gpt-5-mini", () => {
      expect(
        resolveProviderDefaultModel(
          "custom",
          "Custom",
          [],
          [{ modelId: "Qwen2.5-0.5B-Instruct" }],
        ),
      ).not.toContain("gpt-5-mini");
    });

    it("prefers a registry chat model over a custom model when both exist", () => {
      expect(
        resolveProviderDefaultModel(
          "custom",
          "Custom",
          ["llama-3"],
          [{ modelId: "Qwen2.5-0.5B-Instruct" }],
        ),
      ).toBe("custom/llama-3");
    });
  });

  describe("when the provider is a first-class registry provider", () => {
    it("prefixes the registry default with the provider key", () => {
      const result = resolveProviderDefaultModel("openai", "OpenAI", []);
      expect(result.startsWith("openai/")).toBe(true);
    });
  });

  describe("when no model can be resolved", () => {
    it("returns the bare provider label so the gateway surfaces a readable error", () => {
      expect(resolveProviderDefaultModel("custom", "My vLLM", [])).toBe(
        "my vllm",
      );
    });
  });
});

describe("firstEligibleDefaultModel", () => {
  const customProvider: OrgModelProvider = {
    id: "mp-1",
    name: "Self-hosted vLLM",
    provider: "custom",
    scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
    models: [],
    customModels: [{ modelId: "Qwen2.5-0.5B-Instruct" }],
  };

  describe("when a custom provider is eligible at the key's scope", () => {
    /** @scenario Usage example on the key detail page matches the key's provider */
    it("returns custom/<model> so the usage example is servable", () => {
      expect(
        firstEligibleDefaultModel({
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
          providers: [customProvider],
          availableProjects: [],
          organizationId: "org-1",
        }),
      ).toBe("custom/Qwen2.5-0.5B-Instruct");
    });
  });

  describe("when no provider is eligible at the key's scope", () => {
    it("returns undefined so the caller can fall back to a placeholder", () => {
      expect(
        firstEligibleDefaultModel({
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
          providers: [],
          availableProjects: [],
          organizationId: "org-1",
        }),
      ).toBeUndefined();
    });
  });
});
