import { describe, expect, it, vi } from "vitest";

vi.mock("../loadModelCatalog", () => ({
  llmModels: {
    updatedAt: "2026-05-19",
    modelCount: 0,
    models: {
      "openai/gpt-5.5": { id: "openai/gpt-5.5", provider: "openai", mode: "chat" },
      "openai/gpt-5.5-mini": {
        id: "openai/gpt-5.5-mini",
        provider: "openai",
        mode: "chat",
      },
      "openai/gpt-5.4": { id: "openai/gpt-5.4", provider: "openai", mode: "chat" },
      "anthropic/claude-opus-4-5": {
        id: "anthropic/claude-opus-4-5",
        provider: "anthropic",
        mode: "chat",
      },
      "anthropic/claude-opus-4-3": {
        id: "anthropic/claude-opus-4-3",
        provider: "anthropic",
        mode: "chat",
      },
      "anthropic/claude-sonnet-4-5": {
        id: "anthropic/claude-sonnet-4-5",
        provider: "anthropic",
        mode: "chat",
      },
      "anthropic/claude-haiku-4-1": {
        id: "anthropic/claude-haiku-4-1",
        provider: "anthropic",
        mode: "chat",
      },
      "gemini/gemini-2.5-pro": {
        id: "gemini/gemini-2.5-pro",
        provider: "gemini",
        mode: "chat",
      },
      "gemini/gemini-2.5-flash": {
        id: "gemini/gemini-2.5-flash",
        provider: "gemini",
        mode: "chat",
      },
    },
  },
}));

import {
  allLatestAliases,
  expandLatestAlias,
  isLatestAlias,
  parseLatestAlias,
  resolveLatestAlias,
} from "../latestAliases";

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
    it("resolves openai/latest to the newest plain gpt model", () => {
      expect(resolveLatestAlias("openai/latest")).toBe("openai/gpt-5.5");
    });
    it("resolves openai/latest-mini to the newest gpt-X.Y-mini model", () => {
      expect(resolveLatestAlias("openai/latest-mini")).toBe("openai/gpt-5.5-mini");
    });
    it("resolves anthropic/latest to the newest claude-opus model", () => {
      expect(resolveLatestAlias("anthropic/latest")).toBe(
        "anthropic/claude-opus-4-5",
      );
    });
    it("resolves anthropic/latest-mini to the newest claude-sonnet model (not haiku, parallel to gpt-mini ≠ nano)", () => {
      expect(resolveLatestAlias("anthropic/latest-mini")).toBe(
        "anthropic/claude-sonnet-4-5",
      );
    });
    it("resolves gemini/latest to the newest gemini pro model", () => {
      expect(resolveLatestAlias("gemini/latest")).toBe("gemini/gemini-2.5-pro");
    });
    it("resolves gemini/latest-mini to the newest gemini flash model", () => {
      expect(resolveLatestAlias("gemini/latest-mini")).toBe(
        "gemini/gemini-2.5-flash",
      );
    });
    it("returns null for non-aliases", () => {
      expect(resolveLatestAlias("openai/gpt-5.5")).toBeNull();
    });
  });

  describe("when expanding a value that may or may not be an alias", () => {
    it("returns the resolved id for an alias", () => {
      expect(expandLatestAlias("openai/latest")).toBe("openai/gpt-5.5");
    });
    it("returns the input unchanged for a concrete model id", () => {
      expect(expandLatestAlias("azure/gpt-5.5-deployment")).toBe(
        "azure/gpt-5.5-deployment",
      );
    });
  });

  describe("when enumerating all supported aliases", () => {
    it("returns every supported (provider, suffix) pair with resolved value", () => {
      const all = allLatestAliases();
      expect(all).toHaveLength(6);
      expect(all.map((e) => e.alias).sort()).toEqual([
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
