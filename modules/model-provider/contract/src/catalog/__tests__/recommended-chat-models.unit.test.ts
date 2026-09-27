/**
 * @see specs/features/onboarding/guided-welcome-takeover.feature
 */
import { describe, expect, it } from "vitest";

import { pickRecommendedChatModel } from "../latest-aliases.ts";
import { getProviderModelOptions } from "../model-catalog.ts";
import { findRecommendedChatModels } from "../recommended-chat-models.ts";

describe("given the committed model catalog", () => {
  describe("when the chat models are listed for a provider the catalog carries", () => {
    /** @scenario "The recommended model is the newest main-tier model in the catalog" */
    it.each(["openai", "anthropic", "gemini", "deepseek"])(
      "puts %s's recommendation first, then bare catalog names only",
      (provider) => {
        const models = findRecommendedChatModels({ provider, limit: 4 });
        const catalog = new Set(getProviderModelOptions(provider, "chat").map((o) => o.value));

        expect(`${provider}/${models[0]}`).toBe(pickRecommendedChatModel(provider));
        expect(models).toHaveLength(4);
        expect(new Set(models).size).toBe(models.length);
        for (const model of models) {
          expect(model).not.toContain(`${provider}/`);
          expect(catalog.has(model)).toBe(true);
        }
      },
    );
  });

  describe("when the catalog has no chat models for the provider", () => {
    it("offers none rather than a typed guess", () => {
      expect(findRecommendedChatModels({ provider: "custom", limit: 4 })).toEqual([]);
    });
  });
});
