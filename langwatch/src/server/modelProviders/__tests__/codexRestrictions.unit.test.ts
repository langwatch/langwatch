/**
 * Where codex models may run (spec:
 * specs/model-providers/codex-account-provider.feature — "Where Codex may
 * be used"). One gate, four enforcement points; these pin the gate and the
 * two server write/resolve behaviours that depend on it.
 */
import { describe, expect, it } from "vitest";
import {
  CODEX_ALLOWED_FEATURE_KEYS,
  CODEX_DEFAULT_MODEL,
  isCodexAllowedFeature,
  isCodexModel,
  isModelAllowedAsRoleDefault,
  isModelAllowedForFeature,
  LANGY_CHAT_FEATURE_KEY,
} from "../codexRestrictions";
import { allFeatures, featureByKey } from "../featureRegistry";

describe("codexRestrictions", () => {
  it("recognises codex model ids by provider prefix", () => {
    expect(isCodexModel("openai_codex/gpt-5.6-terra")).toBe(true);
    expect(isCodexModel("openai/gpt-5.6-terra")).toBe(false);
    expect(isCodexModel("anthropic/claude-sonnet-5")).toBe(false);
  });

  it("registers every allowed feature key, including langy.chat", () => {
    for (const key of CODEX_ALLOWED_FEATURE_KEYS) {
      expect(featureByKey(key), `feature "${key}" must exist`).toBeTruthy();
    }
    expect(featureByKey(LANGY_CHAT_FEATURE_KEY)?.role).toBe("DEFAULT");
  });

  it("allows codex only on the coding-assistant surfaces", () => {
    expect(
      isModelAllowedForFeature({
        modelId: CODEX_DEFAULT_MODEL,
        featureKey: LANGY_CHAT_FEATURE_KEY,
      }),
    ).toBe(true);
    expect(
      isModelAllowedForFeature({
        modelId: CODEX_DEFAULT_MODEL,
        featureKey: "traces.ai_search",
      }),
    ).toBe(true);
    for (const forbidden of [
      "prompt.create_default",
      "evaluator.create_default",
      "workflows.create_default",
      "scenarios.judge",
      "scenarios.user_simulator",
      "datasets.generator",
    ]) {
      expect(
        isModelAllowedForFeature({
          modelId: CODEX_DEFAULT_MODEL,
          featureKey: forbidden,
        }),
        `${forbidden} must refuse codex`,
      ).toBe(false);
    }
  });

  it("never allows codex as a role-level default", () => {
    expect(isModelAllowedAsRoleDefault(CODEX_DEFAULT_MODEL)).toBe(false);
    expect(isModelAllowedAsRoleDefault("openai/gpt-5-mini")).toBe(true);
  });

  it("leaves unrestricted providers untouched on every feature", () => {
    for (const feature of allFeatures()) {
      expect(
        isModelAllowedForFeature({
          modelId: "openai/gpt-5-mini",
          featureKey: feature.key,
        }),
      ).toBe(true);
    }
  });

  it("keeps the allowed set to coding-assistant surfaces only", () => {
    // The ToC line: Langy plus the tiny assists. Anything appearing here
    // beyond that set needs the same scrutiny the original list got.
    expect([...CODEX_ALLOWED_FEATURE_KEYS].sort()).toEqual(
      [
        "langy.chat",
        "langy.conversation_title",
        "studio.autocomplete",
        "traces.ai_search",
        "translate.text",
        "workflows.commit_message",
      ].sort(),
    );
    expect(isCodexAllowedFeature("prompt.create_default")).toBe(false);
  });
});
