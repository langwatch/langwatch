import { createApiFixture } from "@langwatch/api-fixture";
import type { QueueSimulationRunInput, ScenarioApi } from "@langwatch/scenario-contract";
/**
 * Queued suite run model recording via SuiteExecutionService.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { SuiteExecutionService } from "../suite-execution.service.ts";
import type { SuiteRunModelsResolver } from "../suite-run-models.service.ts";

const scenarioId = "scenario_refund";

/** Starts a run of one case and returns what it asked the scenario owner to queue. */
async function queuedCommandFor(params: {
  simulatorModel?: string | null;
  judgeModel?: string | null;
  resolveRunModels?: SuiteRunModelsResolver;
}): Promise<QueueSimulationRunInput> {
  const queued: QueueSimulationRunInput[] = [];
  const service = SuiteExecutionService.create({
    commands: { startSuiteRun: async () => {} },
    scenarios: createApiFixture<ScenarioApi>({
      resolveRunParametersForScenarios: async ({ scenarios }) =>
        scenarios.map((scenario) => ({
          scenarioId: scenario.id,
          parameters: {},
          secretParameters: {},
          scenarioVersion: 1,
        })),
      queueSimulationRun: async (input) => {
        queued.push(input);
      },
    }),
    ...(params.resolveRunModels ? { resolveRunModels: params.resolveRunModels } : {}),
  });

  await service.execute({
    suiteId: `suite-${Math.random().toString(36).slice(2)}`,
    projectId: `project-${Math.random().toString(36).slice(2)}`,
    activeScenarioIds: [scenarioId],
    scenarioNames: new Map([[scenarioId, "Refund flow"]]),
    scenarioVersions: new Map([[scenarioId, 2]]),
    scenarioConfigs: [
      {
        id: scenarioId,
        name: "Refund flow",
        version: 2,
        situation: "A customer asks for a refund",
        criteria: [],
        parameters: {},
      },
    ],
    activeTargets: [{ type: "http", referenceId: "agent-1" }],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    simulatorModel: params.simulatorModel ?? null,
    judgeModel: params.judgeModel ?? null,
  });

  const command = queued[0];
  if (!command) throw new Error("execute queued no run");
  return command;
}

describe("the models a queued suite run records", () => {
  describe("when the plan names no model and the project has defaults", () => {
    /** @scenario "A queued run records the models it resolved" */
    it("records the models the project default answered with", async () => {
      const command = await queuedCommandFor({
        resolveRunModels: async ({ scenarioIds }) =>
          new Map(
            scenarioIds.map((id) => [
              id,
              { simulatorModel: "openai/gpt-5-mini", judgeModel: "openai/gpt-5" },
            ]),
          ),
      });

      expect(command.resolvedModels).toEqual({
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5",
      });
    });
  });

  describe("when the plan names a model", () => {
    /** @scenario "The resolved models sit beside the configured ones, not in place of them" */
    it("records the configured model and the resolved one", async () => {
      const command = await queuedCommandFor({
        judgeModel: "openai/gpt-5",
        resolveRunModels: async ({ plan, scenarioIds }) =>
          new Map(
            scenarioIds.map((id) => [
              id,
              {
                simulatorModel: "openai/gpt-5-mini",
                judgeModel: plan.judgeModel ?? "openai/gpt-5-mini",
              },
            ]),
          ),
      });

      expect(command.judgeModel).toBe("openai/gpt-5");
      expect(command.resolvedModels?.judgeModel).toBe("openai/gpt-5");
    });
  });

  describe("when the project has no model set for a role", () => {
    /** @scenario "A project with no model set for a role records no resolved model" */
    it("still queues the run, recording no resolved model", async () => {
      const command = await queuedCommandFor({
        resolveRunModels: async () => new Map(),
      });

      expect(command.resolvedModels).toBeNull();
      expect(command.scenarioId).toBe(scenarioId);
    });
  });

  describe("when the process composed no model resolution", () => {
    it("queues the run recording no resolved model", async () => {
      const command = await queuedCommandFor({});

      expect(command.resolvedModels).toBeNull();
    });
  });
});
