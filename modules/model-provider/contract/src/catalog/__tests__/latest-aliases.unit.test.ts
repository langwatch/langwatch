import { describe, expect, it, vi } from "vitest";

vi.mock("../model-catalog.ts", () => {
  const catalog = (...ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { id, provider: id.split("/")[0], mode: "chat" }]));
  return {
    llmModels: {
      updatedAt: "2026-05-19",
      modelCount: 0,
      models: catalog(
        "openai/gpt-5.5",
        "openai/gpt-5.5-mini",
        "openai/gpt-5.5-pro",
        "openai/gpt-5.4",
        // GPT-5.6 ships named tiers and no unsuffixed model: sol on top,
        // terra in the middle, luna as the fast tier. GPT-6 so far ships
        // only astra, a top tier.
        "openai/gpt-5.6-sol",
        "openai/gpt-5.6-sol-pro",
        "openai/gpt-5.6-terra",
        "openai/gpt-5.6-terra-pro",
        "openai/gpt-5.6-terra:batch",
        "openai/gpt-5.6-luna",
        "openai/gpt-6-astra",
        "openai/gpt-6-astra-pro",
        "anthropic/claude-opus-4-8",
        "anthropic/claude-opus-5",
        "anthropic/claude-opus-5:batch",
        "anthropic/claude-fable-5-1",
        "anthropic/claude-sonnet-4-6",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-haiku-4-5",
        "gemini/gemini-2.5-pro",
        "gemini/gemini-3.1-pro-preview",
        "gemini/gemini-3.7-flash",
        "gemini/gemini-3.8-flash",
        "gemini/gemini-3.8-flash:batch",
        "gemini/gemini-3.1-flash-image",
        "gemini/gemini-3.5-flash-lite",
        "gemini/gemini-3.1-flash-lite-preview",
        "deepseek/deepseek-v3.2",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4-pro-0813",
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-flash-vision-exp",
        "deepseek/deepseek-r1",
      ),
    },
  };
});

import {
  allLatestAliases,
  expandLatestAlias,
  isLatestAlias,
  parseLatestAlias,
  recommendedChatModel,
  resolveLatestAlias,
} from "../latest-aliases.ts";

describe("given latest-alias model resolution", () => {
  describe("when checking isLatestAlias", () => {
    it("recognizes openai/latest", () => {
      expect(isLatestAlias("openai/latest")).toBe(true);
    });
    it("recognizes anthropic/latest-mini", () => {
      expect(isLatestAlias("anthropic/latest-mini")).toBe(true);
    });
    it("rejects concrete model ids", () => {
      expect(isLatestAlias("openai/gpt-5.5")).toBe(false);
    });
    it("rejects providers not on the alias list (azure/bedrock pinned to specific deployments)", () => {
      expect(isLatestAlias("azure/latest")).toBe(false);
      expect(isLatestAlias("bedrock/latest")).toBe(false);
    });
  });

  describe("when parsing an alias string", () => {
    it("returns provider + suffix parts", () => {
      expect(parseLatestAlias("gemini/latest-mini")).toEqual({
        provider: "gemini",
        suffix: "latest-mini",
      });
    });
    it("returns null for non-aliases", () => {
      expect(parseLatestAlias("openai/gpt-5.5")).toBeNull();
    });
  });

  describe("when resolving an alias to a concrete id", () => {
    /** @scenario Latest picks the main tier of the newest generation */
    it("resolves openai/latest to the newest generation's main tier", () => {
      expect(resolveLatestAlias("openai/latest")).toBe("openai/gpt-5.6-terra");
    });
    /** @scenario Latest-mini picks the fast tier of the newest generation */
    it("resolves openai/latest-mini to the newest generation's fast tier", () => {
      expect(resolveLatestAlias("openai/latest-mini")).toBe("openai/gpt-5.6-luna");
    });
    /** @scenario The top tier is never an alias target */
    it("never resolves either openai alias to sol or astra", () => {
      for (const alias of ["openai/latest", "openai/latest-mini"]) {
        expect(resolveLatestAlias(alias)).not.toMatch(/sol|astra/);
      }
    });
    /** @scenario Pro serving modes are skipped */
    it("skips -pro serving modes and batch lanes when picking the main tier", () => {
      expect(resolveLatestAlias("openai/latest")).toBe("openai/gpt-5.6-terra");
      expect(resolveLatestAlias("openai/latest")).not.toMatch(/-pro|:batch/);
    });
    /** @scenario Anthropic latest is the newest Opus, never Fable */
    it("resolves anthropic/latest to the newest claude-opus model", () => {
      expect(resolveLatestAlias("anthropic/latest")).toBe("anthropic/claude-opus-5");
    });
    it("resolves anthropic/latest-mini to the newest claude-sonnet model (not haiku, parallel to gpt-luna above nano)", () => {
      expect(resolveLatestAlias("anthropic/latest-mini")).toBe("anthropic/claude-sonnet-5");
    });
    /** @scenario Gemini latest is the newest Flash, never Pro */
    it("resolves gemini/latest to the newest gemini flash model", () => {
      expect(resolveLatestAlias("gemini/latest")).toBe("gemini/gemini-3.8-flash");
    });
    it("resolves gemini/latest-mini to the newest gemini flash-lite model", () => {
      expect(resolveLatestAlias("gemini/latest-mini")).toBe("gemini/gemini-3.5-flash-lite");
    });
    it("returns null for non-aliases", () => {
      expect(resolveLatestAlias("openai/gpt-5.5")).toBeNull();
    });
  });

  describe("when a provider without an alias asks for its recommendation", () => {
    /** @scenario DeepSeek recommends V4 Pro through the same ranking */
    it("recommends the newest main-tier model through the same ranking", () => {
      expect(recommendedChatModel("deepseek")).toBe("deepseek/deepseek-v4-pro");
    });
    it("recommends nothing for a provider the grammar does not read", () => {
      expect(recommendedChatModel("groq")).toBeNull();
    });
  });

  describe("when expanding a value that may or may not be an alias", () => {
    it("returns the resolved id for an alias", () => {
      expect(expandLatestAlias("openai/latest")).toBe("openai/gpt-5.6-terra");
    });
    it("returns the input unchanged for a concrete model id", () => {
      expect(expandLatestAlias("azure/gpt-5.5-deployment")).toBe("azure/gpt-5.5-deployment");
    });
  });

  describe("when enumerating all supported aliases", () => {
    it("returns every supported (provider, suffix) pair with resolved value", () => {
      const all = allLatestAliases();
      expect(all).toHaveLength(6);
      expect(all.map((e) => e.alias).toSorted()).toEqual([
        "anthropic/latest",
        "anthropic/latest-mini",
        "gemini/latest",
        "gemini/latest-mini",
        "openai/latest",
        "openai/latest-mini",
      ]);
      for (const entry of all) {
        expect(entry.resolved).not.toBeNull();
      }
    });
  });
});
