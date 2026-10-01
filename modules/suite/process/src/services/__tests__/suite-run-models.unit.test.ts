import { createApiFixture } from "@langwatch/api-fixture";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import {
  JUDGE_MODEL_FEATURE_KEY,
  SIMULATOR_MODEL_FEATURE_KEY,
  type ScenarioApi,
} from "@langwatch/scenario-contract";
/**
 * @vitest-environment node
 * @see specs/scenarios/resolved-run-models-on-runs.feature
 */
import { describe, expect, it, vi } from "vitest";

import { SuiteRunModelsService } from "../suite-run-models.service.ts";

const projectId = "project-1";

function buildScenarios(
  rows: { id: string; simulatorModel: string | null; judgeModel: string | null }[],
) {
  const getModelChoices = vi.fn(async ({ ids }: { ids: string[] }) =>
    rows.filter((row) => ids.includes(row.id)),
  );
  return { scenarios: createApiFixture<ScenarioApi>({ getModelChoices }), getModelChoices };
}

function buildModelProviders(defaults: Record<string, string>) {
  return createApiFixture<ModelProviderApi>({
    findResolvedDefault: vi.fn<ModelProviderApi["findResolvedDefault"]>(async ({ featureKey }) => {
      const model = defaults[featureKey];
      return model ? { model, source: "role_default", scope: "project" } : null;
    }),
  });
}

describe("SuiteRunModelsService.resolve", () => {
  describe("when a batch names many scenarios", () => {
    it("reads their model choices in one call", async () => {
      const { scenarios, getModelChoices } = buildScenarios([
        { id: "a", simulatorModel: "openai/gpt-5-mini", judgeModel: null },
        { id: "b", simulatorModel: null, judgeModel: "openai/gpt-5" },
      ]);
      const service = SuiteRunModelsService.create({
        scenarios,
        modelProviders: buildModelProviders({
          [JUDGE_MODEL_FEATURE_KEY]: "openai/gpt-5-default",
          [SIMULATOR_MODEL_FEATURE_KEY]: "openai/gpt-5-mini-default",
        }),
      });

      const resolved = await service.resolve({
        projectId,
        scenarioIds: ["a", "b", "a"],
        plan: {},
      });

      expect(getModelChoices).toHaveBeenCalledTimes(1);
      expect(getModelChoices).toHaveBeenCalledWith({
        ids: ["a", "b"],
        projectId,
      });
      expect(resolved.get("a")?.simulatorModel).toBe("openai/gpt-5-mini");
      expect(resolved.get("b")?.judgeModel).toBe("openai/gpt-5");
    });
  });

  describe("when a named scenario has no row", () => {
    it("still resolves it from the project default", async () => {
      const { scenarios } = buildScenarios([]);
      const service = SuiteRunModelsService.create({
        scenarios,
        modelProviders: buildModelProviders({
          [JUDGE_MODEL_FEATURE_KEY]: "openai/gpt-5-default",
          [SIMULATOR_MODEL_FEATURE_KEY]: "openai/gpt-5-mini-default",
        }),
      });

      const resolved = await service.resolve({
        projectId,
        scenarioIds: ["missing"],
        plan: {},
      });

      expect(resolved.get("missing")).toEqual({
        simulatorModel: "openai/gpt-5-mini-default",
        judgeModel: "openai/gpt-5-default",
      });
    });
  });

  describe("when the project has no model set for a role", () => {
    it("records no models rather than throwing", async () => {
      const { scenarios } = buildScenarios([{ id: "a", simulatorModel: null, judgeModel: null }]);
      const service = SuiteRunModelsService.create({
        scenarios,
        modelProviders: buildModelProviders({}),
      });

      const resolved = await service.resolve({
        projectId,
        scenarioIds: ["a"],
        plan: {},
      });

      expect(resolved.size).toBe(0);
    });
  });
});
