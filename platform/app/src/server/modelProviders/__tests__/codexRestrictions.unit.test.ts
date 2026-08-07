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
      "scenarios.agent_under_test",
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

  describe("given the two sibling scenario feature keys", () => {
    // The scenario run's agent-under-test resolution (issue #6634) is a
    // NEW, separate feature key from "scenarios.generator" (the FAST-role
    // authoring assist used by scenario generation, not by a run) — see
    // specs/scenarios/simulation-run-model-resolution.feature. It must be
    // DEFAULT-role (never codex-eligible) so a project whose FAST/coding
    // default is codex still resolves a real inference model for the
    // agent under test.
    describe("when the run-time agent-under-test key is checked", () => {
      it("registers it as DEFAULT-role and refuses codex", () => {
        const feature = featureByKey("scenarios.agent_under_test");
        expect(
          feature,
          'feature "scenarios.agent_under_test" must exist',
        ).toBeTruthy();
        expect(feature?.role).toBe("DEFAULT");
        expect(
          isModelAllowedForFeature({
            modelId: CODEX_DEFAULT_MODEL,
            featureKey: "scenarios.agent_under_test",
          }),
        ).toBe(false);
      });
    });

    describe("when the authoring-time generator key is checked", () => {
      it("keeps it FAST and codex-allowed, unaffected by the new run-time key", () => {
        const generator = featureByKey("scenarios.generator");
        expect(generator?.role).toBe("FAST");
        expect(
          isModelAllowedForFeature({
            modelId: CODEX_DEFAULT_MODEL,
            featureKey: "scenarios.generator",
          }),
        ).toBe(true);
      });
    });
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
