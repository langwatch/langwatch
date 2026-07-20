/**
 * Fail-closed picker gating for restricted-provider (codex) models, the
 * frontend half of specs/model-providers/codex-account-provider.feature
 * ("Where Codex may be used"). The model-vs-feature gate itself lives in
 * codexRestrictions (unit-tested there); these pin the shared filter
 * `useModelSelectionOptions` routes every picker's model list through.
 */
import { describe, expect, it } from "vitest";
import { filterRestrictedModels } from "../ModelSelector";

const MODELS = [
  "openai/gpt-5-mini",
  "anthropic/claude-sonnet-5",
  "openai_codex/gpt-5.6-terra",
  "openai_codex/gpt-5.6-luna",
];

describe("filterRestrictedModels()", () => {
  describe("when the caller declares no featureKey", () => {
    it("excludes every openai_codex model", () => {
      expect(filterRestrictedModels({ models: MODELS })).toEqual([
        "openai/gpt-5-mini",
        "anthropic/claude-sonnet-5",
      ]);
    });

    it("returns non-codex models untouched", () => {
      const unrestricted = ["openai/gpt-5-mini", "anthropic/claude-sonnet-5"];
      expect(filterRestrictedModels({ models: unrestricted })).toEqual(
        unrestricted,
      );
    });
  });

  describe("when the caller declares a codex-licensed featureKey", () => {
    it("includes codex models for langy.chat", () => {
      expect(
        filterRestrictedModels({ models: MODELS, featureKey: "langy.chat" }),
      ).toEqual(MODELS);
    });
  });

  describe("when the caller declares a featureKey codex is not licensed for", () => {
    it("still excludes codex models", () => {
      expect(
        filterRestrictedModels({
          models: MODELS,
          featureKey: "prompt.create_default",
        }),
      ).toEqual(["openai/gpt-5-mini", "anthropic/claude-sonnet-5"]);
    });
  });
});
