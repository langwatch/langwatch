/**
 * @vitest-environment node
 *
 * `SuiteRunModelsService.resolve` reads each scenario's own model choice
 * once for the whole batch, not once per scenario. See suite-restore-review
 * fix 7.
 *
 * @see specs/scenarios/resolved-run-models-on-runs.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import {
  JUDGE_MODEL_FEATURE_KEY,
  SIMULATOR_MODEL_FEATURE_KEY,
  type ScenarioService,
} from "@langwatch/scenario-contract";
import { SuiteRunModelsService } from "../suite-run-models.service";

const projectId = "project-1";

function buildScenarios(
  rows: { id: string; simulatorModel: string | null; judgeModel: string | null }[],
) {
  return {
    getModelChoices: vi.fn(async ({ ids }: { ids: string[] }) =>
      rows.filter((row) => ids.includes(row.id)),
    ),
  } as unknown as ScenarioService;
}

function buildModelProviders(defaults: Record<string, string>) {
  return {
    tryGetResolvedDefault: vi.fn(async ({ featureKey }: { featureKey: string }) => {
      const model = defaults[featureKey];
      return model ? { model, source: "role_default", scope: "project" } : null;
    }),
  } as unknown as ModelProviderService;
}

describe("SuiteRunModelsService.resolve", () => {
  describe("when a batch names many scenarios", () => {
    it("reads their model choices in one call", async () => {
      const scenarios = buildScenarios([
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

      expect(scenarios.getModelChoices).toHaveBeenCalledTimes(1);
      expect(scenarios.getModelChoices).toHaveBeenCalledWith({
        ids: ["a", "b"],
        projectId,
      });
      expect(resolved.get("a")?.simulatorModel).toBe("openai/gpt-5-mini");
      expect(resolved.get("b")?.judgeModel).toBe("openai/gpt-5");
    });
  });

  describe("when a named scenario has no row", () => {
    it("still resolves it from the project default", async () => {
      const scenarios = buildScenarios([]);
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
      const scenarios = buildScenarios([{ id: "a", simulatorModel: null, judgeModel: null }]);
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
