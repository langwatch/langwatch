/**
 * Alias resolution against a catalog that predates OpenAI's named tiers.
 *
 * Lives in its own file because the catalog is injected through a
 * module mock, which is per-file: the sibling `latestAliases.unit.test`
 * pins behaviour against a catalog that does carry GPT-5.6.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../loadModelCatalog", () => ({
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

import { resolveLatestAlias } from "../latestAliases";

describe("given a catalog with no named-tier generation", () => {
  describe("when resolving the openai aliases", () => {
    /** @scenario Older naming still resolves when no newer generation exists */
    it("falls back to the unsuffixed model and its -mini counterpart", () => {
      expect(resolveLatestAlias("openai/latest")).toBe("openai/gpt-5.5");
      expect(resolveLatestAlias("openai/latest-mini")).toBe("openai/gpt-5.5-mini");
    });

    it("still skips the -pro serving mode", () => {
      expect(resolveLatestAlias("openai/latest")).not.toBe("openai/gpt-5.5-pro");
    });
  });
});
