/**
 * Codex gating for the Default Models drawer's pickers (spec:
 * specs/model-providers/codex-account-provider.feature, "Where Codex may
 * be used"). Role-level defaults apply across every feature in the role,
 * so restricted (codex) models are never offered there; a feature-override
 * row re-admits them only when its own feature key is licensed.
 */
import { describe, expect, it } from "vitest";
import {
  featureRowModelOptions,
  roleSelectModelOptions,
} from "../DefaultModelOverrideDrawer";

const POOL = [
  "openai/gpt-5-mini",
  "openai_codex/gpt-5.6-terra",
  "anthropic/claude-sonnet-5",
];

describe("roleSelectModelOptions()", () => {
  describe("when the pool contains codex models", () => {
    it("excludes them from role-level selects", () => {
      expect(roleSelectModelOptions(POOL)).toEqual([
        "openai/gpt-5-mini",
        "anthropic/claude-sonnet-5",
      ]);
    });
  });

  describe("when the pool has no codex models", () => {
    it("returns the pool untouched", () => {
      const unrestricted = ["openai/gpt-5-mini", "anthropic/claude-sonnet-5"];
      expect(roleSelectModelOptions(unrestricted)).toEqual(unrestricted);
    });
  });
});

describe("featureRowModelOptions()", () => {
  describe("when the row's feature is codex-licensed", () => {
    it("includes codex models for langy.chat", () => {
      expect(
        featureRowModelOptions({ options: POOL, featureKey: "langy.chat" }),
      ).toEqual(POOL);
    });

    it("includes codex models for traces.ai_search", () => {
      expect(
        featureRowModelOptions({
          options: POOL,
          featureKey: "traces.ai_search",
        }),
      ).toEqual(POOL);
    });
  });

  describe("when the row's feature is not codex-licensed", () => {
    it("excludes codex models", () => {
      expect(
        featureRowModelOptions({
          options: POOL,
          featureKey: "prompt.create_default",
        }),
      ).toEqual(["openai/gpt-5-mini", "anthropic/claude-sonnet-5"]);
    });
  });
});
