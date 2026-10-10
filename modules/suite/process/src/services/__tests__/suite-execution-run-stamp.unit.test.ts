import type { QueueSimulationRunInput, ScenarioApi } from "@langwatch/scenario-contract";
import { targetKeyOf, type SuiteTarget } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-version-on-runs.feature
 */
import { describe, expect, it } from "vitest";

import { SuiteExecutionService } from "../suite-execution.service.ts";

/** A scenario owner that resolves `resolve`'s values and records every run it is asked to queue. */
function recordingScenarios(
  queued: QueueSimulationRunInput[],
  resolve: (
    values: Record<string, string | number | boolean>,
  ) => Record<string, string> = () => ({}),
): ScenarioApi {
  return createApiFixture<ScenarioApi>({
    resolveRunParametersForScenarios: async ({ scenarios, values }) =>
      scenarios.map((scenario) => ({
        scenarioId: scenario.id,
        parameters: resolve(values ?? {}),
        secretParameters: {},
        scenarioVersion: 1,
      })),
    queueSimulationRun: async (input) => {
      queued.push(input);
    },
  });
}

async function executeAgainst(input: {
  scenarioId: string;
  version: number;
  targets: SuiteTarget[];
  resolve?: (values: Record<string, string | number | boolean>) => Record<string, string>;
}): Promise<QueueSimulationRunInput[]> {
  const queued: QueueSimulationRunInput[] = [];
  const service = SuiteExecutionService.create({
    commands: { startSuiteRun: async () => {} },
    scenarios: recordingScenarios(queued, input.resolve),
  });

  await service.execute({
    suiteId: `suite-${Math.random().toString(36).slice(2)}`,
    projectId: `project-${Math.random().toString(36).slice(2)}`,
    activeScenarioIds: [input.scenarioId],
    scenarioNames: new Map([[input.scenarioId, "A scenario"]]),
    scenarioVersions: new Map([[input.scenarioId, input.version]]),
    scenarioConfigs: [
      {
        id: input.scenarioId,
        name: "A scenario",
        version: input.version,
        situation: "A situation",
        criteria: [],
        parameters: {},
      },
    ],
    activeTargets: input.targets,
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    simulatorModel: null,
    judgeModel: null,
  });

  return queued;
}

async function queueOne(input: {
  scenarioId: string;
  version: number;
  target: SuiteTarget;
}): Promise<QueueSimulationRunInput> {
  const [queued] = await executeAgainst({ ...input, targets: [input.target] });
  if (!queued) throw new Error("execute queued no run");
  return queued;
}

describe("given a run plan whose scenarios are read once at queue time", () => {
  /** @scenario "The version stamped is the version read when the batch was queued" */
  it("carries the version read in that same read", async () => {
    const queued = await queueOne({
      scenarioId: "scenario_1",
      version: 7,
      target: { type: "http", referenceId: "agent_1" },
    });

    expect(queued.scenarioVersion).toBe(7);
  });
});

describe("given a suite run against a prompt target", () => {
  /** @scenario "A suite run records the kind of target as well as the target" */
  it("hands the scenario owner the target it ran against and the kind of that target", async () => {
    const queued = await queueOne({
      scenarioId: "scenario_1",
      version: 1,
      target: { type: "prompt", referenceId: "prompt_9" },
    });

    expect(queued.target).toEqual({ type: "prompt", referenceId: "prompt_9" });
  });
});

describe("given a batch run against one agent twice, once with an override", () => {
  /** @scenario The target key and its parameters travel in the run metadata */
  it("stamps every run with its target key and carries the override on the variant alone", async () => {
    const plain: SuiteTarget = { type: "http", referenceId: "prod-agent" };
    const variant: SuiteTarget = {
      type: "http",
      referenceId: "prod-agent",
      runParameters: { model: "gpt-5-mini" },
    };

    const queued = await executeAgainst({
      scenarioId: "scenario_1",
      version: 1,
      targets: [plain, variant],
      resolve: (values) => ({ region: "eu", model: "gpt-5", ...values }),
    });

    const byTargetKey = new Map(queued.map((run) => [run.targetKey, run]));
    expect([...byTargetKey.keys()]).toEqual(
      expect.arrayContaining([targetKeyOf(plain), targetKeyOf(variant)]),
    );

    const plainRun = byTargetKey.get(targetKeyOf(plain));
    expect(plainRun).not.toHaveProperty("targetParameters");
    expect(plainRun?.parameters).toEqual({ region: "eu", model: "gpt-5" });

    const variantRun = byTargetKey.get(targetKeyOf(variant));
    expect(variantRun?.targetParameters).toEqual({ model: "gpt-5-mini" });
    expect(variantRun?.parameters).toEqual({ region: "eu", model: "gpt-5-mini" });
  });
});
