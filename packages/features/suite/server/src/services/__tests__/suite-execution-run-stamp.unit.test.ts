/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-version-on-runs.feature
 */
import { describe, expect, it } from "vitest";
import type { ScenarioService } from "@langwatch/scenario-contract";

import type { QueueSimulationRunCommandData } from "../../ports/suite-execution.port";
import { SuiteExecutionService } from "../suite-execution.service";

const noopScenarios = {
  resolveRunParametersForScenarios: async ({ scenarios }: { scenarios: { id: string }[] }) =>
    scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      parameters: {},
      secretParameters: {},
      scenarioVersion: 1,
    })),
} as unknown as ScenarioService;

async function queueOne(input: {
  scenarioId: string;
  version: number;
  target: { type: string; referenceId: string };
}): Promise<QueueSimulationRunCommandData> {
  const queued: QueueSimulationRunCommandData[] = [];
  const service = SuiteExecutionService.create({
    commands: {
      startSuiteRun: async () => {},
      queueSimulationRun: async (data) => {
        queued.push(data);
      },
    },
    ids: { next: () => `scenariorun_${Math.random().toString(36).slice(2)}` },
    scenarios: noopScenarios,
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
    activeTargets: [input.target] as never,
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    simulatorModel: null,
    judgeModel: null,
  });

  const command = queued[0];
  if (!command) throw new Error("execute dispatched no queued command");
  return command;
}

function reservedNamespace(command: QueueSimulationRunCommandData): Record<string, unknown> {
  return (command.metadata as { langwatch: Record<string, unknown> }).langwatch;
}

describe("given a run plan whose scenarios are read once at queue time", () => {
  /** @scenario "The version stamped is the version read when the batch was queued" */
  it("carries the version read in that same read", async () => {
    const command = await queueOne({
      scenarioId: "scenario_1",
      version: 7,
      target: { type: "http", referenceId: "agent_1" },
    });

    expect(reservedNamespace(command).scenarioVersion).toBe(7);
  });
});

describe("given a suite run against a prompt target", () => {
  /** @scenario "A suite run records the kind of target as well as the target" */
  it("records the target it ran against and the kind of that target", async () => {
    const command = await queueOne({
      scenarioId: "scenario_1",
      version: 1,
      target: { type: "prompt", referenceId: "prompt_9" },
    });

    expect(reservedNamespace(command)).toMatchObject({
      targetType: "prompt",
      targetReferenceId: "prompt_9",
    });
    expect(command.target).toEqual({ type: "prompt", referenceId: "prompt_9" });
  });
});
