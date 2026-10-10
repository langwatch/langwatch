/**
 * Where codex models may run (spec:
 * specs/model-providers/codex-account-provider.feature). One gate, four
 * enforcement points; these pin the gate and two server behaviours.
 */
import { describe, expect, it } from "vitest";

import {
  CODEX_ALLOWED_FEATURE_KEYS,
  CODEX_DEFAULT_MODEL,
  CONNECTION_TEST_FEATURE_KEY,
  isCodexAllowedFeature,
  isCodexModel,
  isModelAllowedAsRoleDefault,
  isModelAllowedForFeature,
  LANGY_CHAT_FEATURE_KEY,
} from "../codex-restrictions.ts";
import { allFeatures, findFeatureByKey, featuresByRole } from "../model-feature-registry.ts";

describe("codexRestrictions", () => {
  it("recognises codex model ids by provider prefix", () => {
    expect(isCodexModel("openai_codex/gpt-5.6-terra")).toBe(true);
    expect(isCodexModel("openai/gpt-5.6-terra")).toBe(false);
    expect(isCodexModel("anthropic/claude-sonnet-5")).toBe(false);
  });

  it("registers every allowed feature key, with langy.chat on its own role", () => {
    for (const key of CODEX_ALLOWED_FEATURE_KEYS) {
      // The connection test is the one exception: it names no surface anyone
      // configures a model for, so it has no registry entry to find.
      if (key === CONNECTION_TEST_FEATURE_KEY) continue;
      expect(findFeatureByKey(key)[0], `feature "${key}" must exist`).toBeTruthy();
    }
    expect(findFeatureByKey(LANGY_CHAT_FEATURE_KEY)[0]?.role).toBe("LANGY");
    expect(findFeatureByKey(CONNECTION_TEST_FEATURE_KEY)[0]).toBeFalsy();
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
    expect(isModelAllowedAsRoleDefault(CODEX_DEFAULT_MODEL, "LANGY")).toBe(true);
    expect(isModelAllowedAsRoleDefault(CODEX_DEFAULT_MODEL, "FAST")).toBe(true);
    expect(isModelAllowedAsRoleDefault(CODEX_DEFAULT_MODEL, "DEFAULT")).toBe(false);
    expect(isModelAllowedAsRoleDefault(CODEX_DEFAULT_MODEL, "EMBEDDINGS")).toBe(false);
    expect(isModelAllowedAsRoleDefault("openai/gpt-5-mini", "DEFAULT")).toBe(true);
  });

  describe("given the two sibling scenario feature keys", () => {
    // The agent-under-test key (#6634) is separate from "scenarios.generator"
    // (the FAST-role authoring assist, not the run) — see
    // specs/scenarios/simulation-run-model-resolution.feature. It must stay
    // DEFAULT-role so a codex FAST/coding default still resolves a real model.
    describe("when the run-time agent-under-test key is checked", () => {
      it("registers it as DEFAULT-role and refuses codex", () => {
        const feature = findFeatureByKey("scenarios.agent_under_test")[0];
        expect(feature, 'feature "scenarios.agent_under_test" must exist').toBeTruthy();
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
        const generator = findFeatureByKey("scenarios.generator")[0];
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
    expect([...CODEX_ALLOWED_FEATURE_KEYS].toSorted()).toEqual(
      [
        "langy.chat",
        "model_provider.connection_test",
        "langy.conversation_title",
        "studio.autocomplete",
        "traces.ai_search",
        "translate.text",
        "workflows.commit_message",
        "scenarios.generator",
        "datasets.generator",
        "analytics.topic_clustering_llm",
      ].toSorted(),
    );
    expect(isCodexAllowedFeature("prompt.create_default")).toBe(false);
  });
});
