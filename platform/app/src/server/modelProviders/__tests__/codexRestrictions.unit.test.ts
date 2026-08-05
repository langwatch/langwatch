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
import { allFeatures, featureByKey, featuresByRole } from "../featureRegistry";

describe("codexRestrictions", () => {
  it("recognises codex model ids by provider prefix", () => {
    expect(isCodexModel("openai_codex/gpt-5.6-terra")).toBe(true);
    expect(isCodexModel("openai/gpt-5.6-terra")).toBe(false);
    expect(isCodexModel("anthropic/claude-sonnet-5")).toBe(false);
  });

  it("registers every allowed feature key, with langy.chat on its own role", () => {
    for (const key of CODEX_ALLOWED_FEATURE_KEYS) {
      expect(featureByKey(key), `feature "${key}" must exist`).toBeTruthy();
    }
    expect(featureByKey(LANGY_CHAT_FEATURE_KEY)?.role).toBe("LANGY");
  });

  it("allows codex on Langy and the fast assists, nowhere else", () => {
    expect(
      isModelAllowedForFeature({
        modelId: CODEX_DEFAULT_MODEL,
        featureKey: LANGY_CHAT_FEATURE_KEY,
      }),
    ).toBe(true);
    for (const fast of featuresByRole("FAST")) {
      expect(
        isModelAllowedForFeature({
          modelId: CODEX_DEFAULT_MODEL,
          featureKey: fast.key,
        }),
        `${fast.key} is a fast assist and must accept codex`,
      ).toBe(true);
    }
    for (const forbidden of [
      "prompt.create_default",
      "evaluator.create_default",
      "workflows.create_default",
      "scenarios.judge",
      "scenarios.user_simulator",
      "analytics.topic_clustering_embeddings",
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

  it("allows codex as a role default only for LANGY and FAST", () => {
    expect(isModelAllowedAsRoleDefault(CODEX_DEFAULT_MODEL, "LANGY")).toBe(
      true,
    );
    expect(isModelAllowedAsRoleDefault(CODEX_DEFAULT_MODEL, "FAST")).toBe(true);
    expect(isModelAllowedAsRoleDefault(CODEX_DEFAULT_MODEL, "DEFAULT")).toBe(
      false,
    );
    expect(isModelAllowedAsRoleDefault(CODEX_DEFAULT_MODEL, "EMBEDDINGS")).toBe(
      false,
    );
    expect(isModelAllowedAsRoleDefault("openai/gpt-5-mini", "DEFAULT")).toBe(
      true,
    );
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

  it("pins the allowed set: langy.chat plus exactly the FAST tier", () => {
    // The rule is derived (Langy + every FAST feature); this pin makes any
    // widening of it — a feature moving into FAST, a new fast assist — show
    // up in review rather than land silently.
    expect([...CODEX_ALLOWED_FEATURE_KEYS].sort()).toEqual(
      [
        "langy.chat",
        "langy.conversation_title",
        "studio.autocomplete",
        "traces.ai_search",
        "translate.text",
        "workflows.commit_message",
        "scenarios.generator",
        "datasets.generator",
        "analytics.topic_clustering_llm",
      ].sort(),
    );
    expect(isCodexAllowedFeature("prompt.create_default")).toBe(false);
  });
});
