/**
 * Regression: the legacy evaluations REST route (POST /api/evaluations/...)
 * used to call `getEvaluatorDefaultSettings(evaluatorDefinition)` WITHOUT the
 * resolved-model argument, so every API-triggered evaluation fell through to
 * the hardcoded global `DEFAULT_MODEL` and ignored the project's model cascade
 * configuration (issue #5468).
 *
 * The fix threads `resolveEvaluatorSettingsDefaults(project.id)` — which wraps
 * the same cascade resolver the UI and server-side create path use — into the
 * settings-merge, so a project with a custom default model gets that model.
 *
 * These tests pin:
 *  - AC#3/#4/#6: `resolveEvaluatorSettingsDefaults` returns the cascade model
 *    for the correct project + the `evaluator.create_default` feature key.
 *  - AC#2:       when the cascade has nothing configured (resolver -> null),
 *    `getEvaluatorDefaultSettings` still falls back to `DEFAULT_MODEL`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getEvaluatorDefaultSettings } from "@langwatch/evaluator-contract";
import {
  ModelNotConfiguredError,
  type ModelProviderResolution,
} from "@langwatch/model-provider-contract";
import { TestModelProviderService } from "~/server/modelProviders/__tests__/model-provider-services.test-support";
import { DEFAULT_MODEL } from "~/utils/constants";
import { resolveEvaluatorSettingsDefaults } from "../evaluations-legacy";

// A minimal evaluator definition whose settings carry a `model` field — the
// exact shape `getEvaluatorDefaultSettings` maps the resolved default onto.
const evaluatorWithModel = {
  name: "LLM Judge",
  requiredFields: ["input", "output"],
  optionalFields: [],
  settings: {
    model: { default: "openai/gpt-5" },
    max_tokens: { default: 8192 },
  },
} as any;

const resolution = (
  model: string,
  featureKey: "evaluator.create_default" | "analytics.topic_clustering_embeddings",
  source: ModelProviderResolution["source"] = "feature_override",
  scope: ModelProviderResolution["scope"] = "project",
): ModelProviderResolution => ({
  model,
  source,
  scope,
  feature:
    featureKey === "evaluator.create_default"
      ? {
          key: featureKey,
          role: "DEFAULT",
          displayName: "New evaluator model",
          description: "Model written into a freshly created LLM-as-a-judge evaluator.",
        }
      : {
          key: featureKey,
          role: "EMBEDDINGS",
          displayName: "Topic clustering",
          description: "Vectors used to group similar traces in Analytics → Topics.",
        },
});

describe("resolveEvaluatorSettingsDefaults", () => {
  const modelProviders = new TestModelProviderService();
  const resolveModel = vi.spyOn(modelProviders, "resolveModelForFeature");

  beforeEach(() => {
    resolveModel.mockReset();
  });

  describe("when the project has a custom default model configured", () => {
    it("maps the cascade-resolved model into { defaultModel, embeddingsModel }", async () => {
      resolveModel.mockImplementation(async (input) => {
        if (input.featureKey === "evaluator.create_default") {
          return resolution("openai/gpt-5-mini", "evaluator.create_default");
        }
        return resolution("openai/text-embedding-3-large", "analytics.topic_clustering_embeddings");
      });

      const resolved = await resolveEvaluatorSettingsDefaults("proj-1", modelProviders);

      expect(resolved).toEqual({
        defaultModel: "openai/gpt-5-mini",
        embeddingsModel: "openai/text-embedding-3-large",
      });
      // The embeddings model must come from its own feature key — a typo'd
      // key would fall into the mock's catch-all and still return the right
      // value, so pin the exact second call.
      expect(resolveModel).toHaveBeenCalledWith({
        projectId: "proj-1",
        featureKey: "analytics.topic_clustering_embeddings",
      });
    });

    it("resolves for the given project id and the evaluator.create_default feature key (AC#3/#4)", async () => {
      resolveModel.mockResolvedValue(
        resolution("openai/gpt-5-mini", "evaluator.create_default", "role_default", "team"),
      );

      await resolveEvaluatorSettingsDefaults("proj-42", modelProviders);

      expect(resolveModel).toHaveBeenCalledWith({
        projectId: "proj-42",
        featureKey: "evaluator.create_default",
      });
      // Never called with an undefined project id (AC#4).
      for (const call of resolveModel.mock.calls) {
        expect(call[0].projectId).toBe("proj-42");
      }
    });

    it("feeds getEvaluatorDefaultSettings the custom model, not DEFAULT_MODEL (AC#6)", async () => {
      resolveModel.mockResolvedValue(resolution("openai/gpt-5-mini", "evaluator.create_default"));

      const resolved = await resolveEvaluatorSettingsDefaults("proj-1", modelProviders);
      const settings = getEvaluatorDefaultSettings(evaluatorWithModel, resolved);

      expect((settings as any).model).toBe("openai/gpt-5-mini");
      expect((settings as any).model).not.toBe(DEFAULT_MODEL);
    });
  });

  describe("when the evaluator definition carries no settings (custom evaluator)", () => {
    it("getEvaluatorDefaultSettings returns {} instead of throwing (regression)", () => {
      // getEvaluatorIncludingCustom builds custom (non-workflow) definitions
      // as { name, requiredFields } with NO `settings`; the legacy dispatch
      // route used to hand those straight to getEvaluatorDefaultSettings,
      // which crashed on Object.entries(undefined).
      const customDefinition = {
        name: "Custom evaluator",
        requiredFields: ["input"],
      } as any;

      expect(getEvaluatorDefaultSettings(customDefinition)).toEqual({});
    });
  });

  describe("when the project has no custom default configured (resolver returns null)", () => {
    it("returns nulls so getEvaluatorDefaultSettings falls back to DEFAULT_MODEL (AC#2)", async () => {
      resolveModel.mockRejectedValue(
        new ModelNotConfiguredError(
          "evaluator.create_default",
          "DEFAULT",
          "New evaluator model",
          "proj-1",
        ),
      );

      const resolved = await resolveEvaluatorSettingsDefaults("proj-1", modelProviders);
      expect(resolved).toEqual({ defaultModel: null, embeddingsModel: null });

      const settings = getEvaluatorDefaultSettings(evaluatorWithModel, resolved, {
        defaultModel: DEFAULT_MODEL,
        embeddingsModel: "openai/text-embedding-3-small",
      });
      expect((settings as any).model).toBe(DEFAULT_MODEL);
    });
  });
});
