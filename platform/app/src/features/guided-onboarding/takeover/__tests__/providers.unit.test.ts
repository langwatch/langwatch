import { describe, expect, it } from "vitest";
import { recommendedChatModel } from "~/server/modelProviders/latestAliases";
import { getProviderModelOptions } from "~/server/modelProviders/registry";
import {
  GUIDED_MODEL_PILLS_MAX,
  GUIDED_PROVIDERS,
  type GuidedProvider,
  guidedChatModels,
  registrySpecFor,
} from "../providers";

const apiKeyProviders = GUIDED_PROVIDERS.filter(
  (provider) => provider.kind === "api-key",
);

const guided = (id: GuidedProvider["id"]): GuidedProvider => {
  const provider = GUIDED_PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`no guided provider ${id}`);
  return provider;
};

describe("given the guided provider card's chat model pills", () => {
  describe("when an API-key provider with a catalog is listed", () => {
    /** @scenario The recommended model is the newest main-tier model in the catalog */
    it.each([
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
    ] as const)("puts the catalog's recommendation first for %s", (id) => {
      const provider = guided(id);
      const backend = registrySpecFor(provider).backendModelProviderKey;
      const recommended = recommendedChatModel(backend);
      expect(recommended).not.toBeNull();

      const pills = guidedChatModels(provider);
      expect(pills[0]).toBe(recommended!.slice(backend.length + 1));
      expect(pills).toHaveLength(GUIDED_MODEL_PILLS_MAX);
      expect(new Set(pills).size).toBe(pills.length);
    });

    it("offers only bare catalog names, none carrying the provider prefix", () => {
      for (const provider of apiKeyProviders) {
        const backend = registrySpecFor(provider).backendModelProviderKey;
        const catalog = new Set(
          getProviderModelOptions(backend, "chat").map((o) => o.value),
        );
        for (const pill of guidedChatModels(provider)) {
          expect(pill).not.toContain("/");
          expect(catalog.has(pill)).toBe(true);
        }
      }
    });
  });

  describe("when the catalog has no chat models for the provider", () => {
    it("offers no pills rather than a typed guess", () => {
      expect(guidedChatModels(guided("groq"))).toEqual([]);
    });
  });
});
