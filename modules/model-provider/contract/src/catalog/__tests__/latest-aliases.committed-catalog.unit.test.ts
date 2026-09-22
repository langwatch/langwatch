/**
 * The recommendation against the committed catalog. It is synced weekly, so
 * a pin that fails after a sync is either a release to accept or a grammar
 * that stopped reading the provider's ids.
 */
import { describe, expect, it } from "vitest";

import { recommendedChatModel, resolveLatestAlias } from "../latest-aliases.ts";
import { getModelById } from "../model-catalog.ts";

describe("given the committed model catalog", () => {
  describe("when the recommendation is read per provider", () => {
    /** @scenario The recommendation is the newest main-tier model of each provider */
    it.each([
      ["openai", "openai/gpt-5.6-terra"],
      ["anthropic", "anthropic/claude-opus-5"],
      ["gemini", "gemini/gemini-3.8-flash"],
      ["deepseek", "deepseek/deepseek-v4-pro"],
    ])("recommends %s's newest main-tier model", (provider, expected) => {
      expect(recommendedChatModel(provider)).toBe(expected);
      expect(getModelById(expected)?.mode).toBe("chat");
    });

    /** @scenario The recommendation is never the top tier, a serving mode or a batch lane */
    it("never recommends the top tier, a serving mode or a batch lane", () => {
      for (const provider of ["openai", "anthropic", "gemini", "deepseek"]) {
        const pick = recommendedChatModel(provider) ?? "";
        expect(pick).not.toMatch(/astra|-sol|fable|gemini-[\d.]+-pro|:batch|-\d{4}$|-exp$/);
      }
    });

    it("recommends nothing for a provider the catalog has no chat models for", () => {
      expect(recommendedChatModel("groq")).toBeNull();
      expect(recommendedChatModel("azure")).toBeNull();
      expect(recommendedChatModel("bedrock")).toBeNull();
      expect(recommendedChatModel("custom")).toBeNull();
    });
  });

  describe("when the aliases are resolved", () => {
    /** @scenario The latest alias and the recommendation are the same pick */
    it.each(["openai", "anthropic", "gemini"])(
      "resolves %s/latest to the recommendation",
      (provider) => {
        expect(resolveLatestAlias(`${provider}/latest`)).toBe(recommendedChatModel(provider));
      },
    );

    /** @scenario Latest-mini resolves to the fast tier of each provider */
    it.each([
      ["openai", "openai/gpt-5.6-luna"],
      ["anthropic", "anthropic/claude-sonnet-5"],
      ["gemini", "gemini/gemini-3.5-flash-lite"],
    ])("resolves %s/latest-mini to the newest fast-tier model", (provider, expected) => {
      expect(resolveLatestAlias(`${provider}/latest-mini`)).toBe(expected);
    });
  });
});
