/**
 * The Agent Platform door serves chat but not embeddings (verified live:
 * `:batchEmbedContents` answers 404 on aiplatform.googleapis.com), so
 * embedding pickers must not offer registry models the credential that
 * will actually serve them cannot run.
 *
 * "Actually serve" is the load-bearing part: a registry model is listed in
 * no row's custom catalog, so execution keeps the scope-collapse winner
 * (ModelProviderService.findRowServingModel returns null, resolveServingRow
 * falls back). Availability therefore follows the winner, not the union of
 * accessible rows.
 *
 * Covers @unit scenarios from
 * specs/model-providers/google-agent-platform.feature.
 */
import { describe, expect, it } from "vitest";
import { providersWithoutRegistryModels } from "../ModelSelector";

const apRow = {
  provider: "gemini",
  enabled: true,
  scopeType: "PROJECT",
  embeddingsUnsupported: true,
};

const studioRow = {
  provider: "gemini",
  enabled: true,
  scopeType: "PROJECT",
  embeddingsUnsupported: false,
};

const hidden = (rows: Parameters<typeof providersWithoutRegistryModels>[0]) =>
  providersWithoutRegistryModels(rows, "embedding").has("gemini");

describe("providersWithoutRegistryModels", () => {
  describe("given the only enabled Gemini credential carries a project and location", () => {
    /** @scenario Embedding models are not offered through a door that cannot serve them */
    it("hides the Gemini registry embedding models", () => {
      expect(hidden([apRow])).toBe(true);
    });
  });

  describe("given a Gemini credential without the pair", () => {
    /** @scenario Embedding models are not offered through a door that cannot serve them */
    it("keeps them available", () => {
      expect(hidden([studioRow])).toBe(false);
    });

    it("treats an env-fed system row the server marked as serving embeddings as available", () => {
      expect(hidden([{ provider: "gemini", enabled: true, scopeType: undefined }])).toBe(
        false,
      );
    });
  });

  describe("given an Agent Platform row at project scope beside an AI Studio row at organization scope", () => {
    /**
     * The reviewer's case, and the reason the rule is not "any row can
     * serve them". Execution collapses to the narrowest enabled row — the
     * project one — so the wider AI Studio row never runs, and offering
     * the models would guarantee a 404.
     */
    /** @scenario A wider-scope AI Studio row does not rescue a narrower Agent Platform row */
    it("hides them: the narrower Agent Platform row is the one that runs", () => {
      expect(
        hidden([
          { ...apRow, scopeType: "PROJECT" },
          { ...studioRow, scopeType: "ORGANIZATION" },
        ]),
      ).toBe(true);
    });
  });

  describe("given an AI Studio row at project scope beside an Agent Platform row at organization scope", () => {
    /** @scenario A wider-scope AI Studio row does not rescue a narrower Agent Platform row */
    it("keeps them available: the narrower AI Studio row is the one that runs", () => {
      expect(
        hidden([
          { ...studioRow, scopeType: "PROJECT" },
          { ...apRow, scopeType: "ORGANIZATION" },
        ]),
      ).toBe(false);
    });
  });

  describe("given both doors configured at the same scope", () => {
    it("hides them — either row can win, and one of them cannot serve", () => {
      expect(hidden([apRow, studioRow])).toBe(true);
    });
  });

  describe("given no enabled Gemini rows", () => {
    it("reports available — the provider gate already hides the models", () => {
      expect(hidden([])).toBe(false);
      expect(hidden([{ ...apRow, enabled: false }])).toBe(false);
    });
  });

  describe("given a disabled AI Studio row beside an enabled Agent Platform row", () => {
    it("only enabled rows count", () => {
      expect(hidden([{ ...studioRow, enabled: false }, apRow])).toBe(true);
    });
  });

  describe("when the picker is in chat mode", () => {
    it("hides nothing — the Agent Platform door serves chat", () => {
      expect(providersWithoutRegistryModels([apRow], "chat").size).toBe(0);
    });
  });
});
