/**
 * Alias resolution against a catalog that predates OpenAI's named tiers.
 * Lives in its own file since the catalog mock is per-file: the sibling
 * `latestAliases.unit.test` pins behaviour against a catalog with GPT-5.6.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../model-catalog.ts", () => ({
  llmModels: {
    updatedAt: "2026-05-19",
    modelCount: 0,
    models: {
      "openai/gpt-5.5": {
        id: "openai/gpt-5.5",
        provider: "openai",
        mode: "chat",
      },
      "openai/gpt-5.5-mini": {
        id: "openai/gpt-5.5-mini",
        provider: "openai",
        mode: "chat",
      },
      "openai/gpt-5.5-pro": {
        id: "openai/gpt-5.5-pro",
        provider: "openai",
        mode: "chat",
      },
      "openai/gpt-5.4": {
        id: "openai/gpt-5.4",
        provider: "openai",
        mode: "chat",
      },
      "openai/gpt-5.4-mini": {
        id: "openai/gpt-5.4-mini",
        provider: "openai",
        mode: "chat",
      },
    },
  },
}));

import { findAliasTarget } from "../latest-aliases.ts";

describe("given a catalog with no named-tier generation", () => {
  describe("when resolving the openai aliases", () => {
    /** @scenario Older naming still resolves when no newer generation exists */
    it("falls back to the unsuffixed model and its -mini counterpart", () => {
      expect(findAliasTarget("openai/latest")[0]).toBe("openai/gpt-5.5");
      expect(findAliasTarget("openai/latest-mini")[0]).toBe("openai/gpt-5.5-mini");
    });

    it("still skips the -pro serving mode", () => {
      expect(findAliasTarget("openai/latest")[0]).not.toBe("openai/gpt-5.5-pro");
    });
  });
});
