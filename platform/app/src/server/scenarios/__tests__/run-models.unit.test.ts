/**
 * @vitest-environment node
 *
 * The chain that picks the models a run runs on, and the metadata entries it
 * turns into. One definition serves the queue path and the execution prefetch,
 * so a break here makes a run say one model and run another.
 *
 * @see specs/scenarios/resolved-run-models-on-runs.feature
 */

import { describe, expect, it, vi } from "vitest";
import {
  JUDGE_MODEL_FEATURE_KEY,
  resolveRunModels,
  SIMULATOR_MODEL_FEATURE_KEY,
  withResolvedModels,
} from "../run-models";

/** Answers every feature key with a name that says which key was asked. */
function projectDefaults() {
  return vi.fn(async (featureKey: string) => `default-for/${featureKey}`);
}

describe("the models a run resolves", () => {
  describe("when the run plan names a model", () => {
    /** @scenario "A run plan that names a model resolves that model" */
    it("takes the plan's model over the case's own", async () => {
      const resolveFeatureModel = projectDefaults();

      const models = await resolveRunModels({
        plan: { simulatorModel: "openai/gpt-5-mini" },
        scenario: { simulatorModel: "openai/gpt-4o-mini" },
        resolveFeatureModel,
      });

      expect(models.simulatorModel).toBe("openai/gpt-5-mini");
      expect(resolveFeatureModel).not.toHaveBeenCalledWith(
        SIMULATOR_MODEL_FEATURE_KEY,
      );
    });
  });

  describe("when the run plan names no model", () => {
    /** @scenario "A scenario answers when its run plan names no model" */
    it("takes the case's own model", async () => {
      const resolveFeatureModel = projectDefaults();

      const models = await resolveRunModels({
        plan: { judgeModel: null },
        scenario: { judgeModel: "anthropic/claude-sonnet-4" },
        resolveFeatureModel,
      });

      expect(models.judgeModel).toBe("anthropic/claude-sonnet-4");
      expect(resolveFeatureModel).not.toHaveBeenCalledWith(
        JUDGE_MODEL_FEATURE_KEY,
      );
    });
  });

  describe("when neither the plan nor the case names a model", () => {
    /** @scenario "The project default answers when neither the plan nor the scenario names a model" */
    it("reads the project default of each role", async () => {
      const models = await resolveRunModels({
        plan: {},
        scenario: {},
        resolveFeatureModel: projectDefaults(),
      });

      expect(models).toEqual({
        simulatorModel: `default-for/${SIMULATOR_MODEL_FEATURE_KEY}`,
        judgeModel: `default-for/${JUDGE_MODEL_FEATURE_KEY}`,
      });
    });
  });
});

describe("the resolved-model entries of the reserved namespace", () => {
  describe("when both models resolved", () => {
    it("names both", () => {
      expect(
        withResolvedModels({
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5",
        }),
      ).toEqual({
        resolvedSimulatorModel: "openai/gpt-5-mini",
        resolvedJudgeModel: "openai/gpt-5",
      });
    });
  });

  describe("when no model resolved", () => {
    it("writes nothing at all", () => {
      expect(withResolvedModels(undefined)).toEqual({});
    });
  });
});
