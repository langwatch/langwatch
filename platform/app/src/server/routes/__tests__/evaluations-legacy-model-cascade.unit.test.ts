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

// The route module imports prisma (db) and the app layer at load time; stub
// the resolver so no DB is touched. `prisma` itself is only handed to the
// resolver as `ctx.prisma`, which the mock ignores.
const getResolvedDefaultForFeature = vi.fn();
vi.mock("~/server/modelProviders/modelDefaults.read", () => ({
  getResolvedDefaultForFeature: (...args: unknown[]) =>
    getResolvedDefaultForFeature(...args),
}));

import { getEvaluatorDefaultSettings } from "~/server/evaluations/getEvaluator";
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

describe("resolveEvaluatorSettingsDefaults", () => {
  beforeEach(() => {
    getResolvedDefaultForFeature.mockReset();
  });

  describe("when the project has a custom default model configured", () => {
    it("maps the cascade-resolved model into { defaultModel, embeddingsModel }", async () => {
      getResolvedDefaultForFeature.mockImplementation(
        async (_ctx: unknown, params: { featureKey: string }) => {
          if (params.featureKey === "evaluator.create_default") {
            return {
              model: "openai/gpt-4o",
              source: "feature_override",
              scope: "project",
            };
          }
          return {
            model: "openai/text-embedding-3-large",
            source: "feature_override",
            scope: "project",
          };
        },
      );

      const resolved = await resolveEvaluatorSettingsDefaults("proj-1");

      expect(resolved).toEqual({
        defaultModel: "openai/gpt-4o",
        embeddingsModel: "openai/text-embedding-3-large",
      });
    });

    it("resolves for the given project id and the evaluator.create_default feature key (AC#3/#4)", async () => {
      getResolvedDefaultForFeature.mockResolvedValue({
        model: "anthropic/claude-3-5-sonnet",
        source: "role_default",
        scope: "team",
      });

      await resolveEvaluatorSettingsDefaults("proj-42");

      expect(getResolvedDefaultForFeature).toHaveBeenCalledWith(
        expect.anything(),
        { projectId: "proj-42", featureKey: "evaluator.create_default" },
      );
      // Never called with an undefined project id (AC#4).
      for (const call of getResolvedDefaultForFeature.mock.calls) {
        expect(call[1].projectId).toBe("proj-42");
      }
    });

    it("feeds getEvaluatorDefaultSettings the custom model, not DEFAULT_MODEL (AC#6)", async () => {
      getResolvedDefaultForFeature.mockResolvedValue({
        model: "openai/gpt-4o",
        source: "feature_override",
        scope: "project",
      });

      const resolved = await resolveEvaluatorSettingsDefaults("proj-1");
      const settings = getEvaluatorDefaultSettings(
        evaluatorWithModel,
        resolved,
      );

      expect((settings as any).model).toBe("openai/gpt-4o");
      expect((settings as any).model).not.toBe(DEFAULT_MODEL);
    });
  });

  describe("when the project has no custom default configured (resolver returns null)", () => {
    it("returns nulls so getEvaluatorDefaultSettings falls back to DEFAULT_MODEL (AC#2)", async () => {
      getResolvedDefaultForFeature.mockResolvedValue(null);

      const resolved = await resolveEvaluatorSettingsDefaults("proj-1");
      expect(resolved).toEqual({ defaultModel: null, embeddingsModel: null });

      const settings = getEvaluatorDefaultSettings(
        evaluatorWithModel,
        resolved,
      );
      expect((settings as any).model).toBe(DEFAULT_MODEL);
    });
  });
});
