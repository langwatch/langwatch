/**
 * The Agent Platform door serves chat but not embeddings (verified live:
 * `:batchEmbedContents` answers 404 on aiplatform.googleapis.com), so
 * embedding pickers must not offer Gemini registry models when every
 * enabled Gemini credential goes through that door.
 *
 * Covers @unit scenarios from
 * specs/model-providers/google-agent-platform.feature.
 */
import { describe, expect, it } from "vitest";
import { geminiEmbeddingsUnavailable } from "../ModelSelector";

const apRow = {
  provider: "gemini",
  enabled: true,
  customKeys: {
    GEMINI_API_KEY: "***",
    GEMINI_PROJECT: "acme-123",
    GEMINI_LOCATION: "global",
  },
};

const studioRow = {
  provider: "gemini",
  enabled: true,
  customKeys: { GEMINI_API_KEY: "***" },
};

describe("geminiEmbeddingsUnavailable", () => {
  describe("given the only enabled Gemini credential carries a project and location", () => {
    /** @scenario Embedding models are not offered through a door that cannot serve them */
    it("reports embeddings unavailable", () => {
      expect(geminiEmbeddingsUnavailable([apRow])).toBe(true);
    });
  });

  describe("given a Gemini credential without the pair", () => {
    /** @scenario Embedding models are not offered through a door that cannot serve them */
    it("keeps embeddings available, alone or beside an Agent Platform row", () => {
      expect(geminiEmbeddingsUnavailable([studioRow])).toBe(false);
      expect(geminiEmbeddingsUnavailable([apRow, studioRow])).toBe(false);
    });

    it("treats an env-fed system row (null customKeys) as the AI Studio door", () => {
      expect(
        geminiEmbeddingsUnavailable([
          { provider: "gemini", enabled: true, customKeys: null },
        ]),
      ).toBe(false);
    });
  });

  describe("given no enabled Gemini rows", () => {
    it("reports available — the provider gate already hides the models", () => {
      expect(geminiEmbeddingsUnavailable([])).toBe(false);
      expect(geminiEmbeddingsUnavailable([{ ...apRow, enabled: false }])).toBe(
        false,
      );
    });
  });

  describe("given a disabled Agent Platform row beside an enabled one", () => {
    it("only enabled rows count", () => {
      expect(
        geminiEmbeddingsUnavailable([{ ...studioRow, enabled: false }, apRow]),
      ).toBe(true);
    });
  });
});
