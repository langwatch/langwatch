import type {
  QueueSimulationRunInput,
  RunEvaluators,
  ScenarioApi,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
/**
 * The evaluators a suite pins on each run it queues, via SuiteExecutionService.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  SuiteExecutionService,
  type SuiteRunEvaluatorsResolver,
} from "../suite-execution.service.ts";

const scenarioId = "scenario_refund";

/** Starts a run of one case and returns what it asked the scenario owner to queue. */
async function queuedCommandFor(params: {
  resolveRunEvaluators?: SuiteRunEvaluatorsResolver;
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
    ...(params.resolveRunEvaluators ? { resolveRunEvaluators: params.resolveRunEvaluators } : {}),
  });

  await service.execute({
    suiteId: "suite-nightly",
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
    simulatorModel: null,
    judgeModel: null,
  });

  const command = queued[0];
  if (!command) throw new Error("execute queued no run");
  return command;
}

const pinned: RunEvaluators = {
  suiteId: "test-suite-1",
  planId: "suite-nightly",
  attachments: [{ id: "attachment-1", evaluatorId: "evaluator-1", required: false, mappings: {} }],
  definitions: [],
};

describe("the evaluators a queued suite run carries", () => {
  describe("when the suite reads the scenario's evaluators", () => {
    /** @scenario "A suite pins each run's evaluators as it queues it" */
    it("queues the run with its test suite's and its plan's evaluators", async () => {
      const asked: Parameters<SuiteRunEvaluatorsResolver>[0][] = [];
      const command = await queuedCommandFor({
        resolveRunEvaluators: async (input) => {
          asked.push(input);
          return pinned;
        },
      });

      expect(asked).toEqual([
        { projectId: expect.any(String), scenarioId, planId: "suite-nightly" },
      ]);
      expect(command.evaluators).toEqual(pinned);
    });
  });

  describe("when the evaluators cannot be read", () => {
    it("still queues the run, leaving scenario to read them", async () => {
      const command = await queuedCommandFor({
        resolveRunEvaluators: () => Promise.reject(new Error("store down")),
      });

      expect(command.evaluators).toBeUndefined();
    });
  });
});
