/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-run-parameters.feature
 */
import { resolveRunParameters, type ScenarioService } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import type { QueueSimulationRunCommandData } from "../../ports/suite-execution.port";
import { SuiteExecutionService } from "../suite-execution.service";

const scenarioId = "scenario_refund";

/** Delegates to the real parameter-resolution rules, with no encryption. */
const declaringScenarios = {
  resolveRunParametersForScenarios: async ({
    scenarios,
    values,
  }: {
    scenarios: { id: string }[];
    values?: Record<string, unknown>;
  }) => {
    const resolved = await resolveRunParameters({
      scenarios: scenarios as never,
      values: values as never,
    });
    return [...resolved].map(([id, value]) => ({
      scenarioId: id,
      parameters: value.parameters,
      secretParameters: value.secretParameters,
      scenarioVersion: 1,
    }));
  },
} as unknown as ScenarioService;

function execute(
  runParameters: Record<string, unknown>,
  tracking: { queued: QueueSimulationRunCommandData[]; started: boolean },
): Promise<unknown> {
  const service = SuiteExecutionService.create({
    commands: {
      startSuiteRun: async () => {
        tracking.started = true;
      },
      queueSimulationRun: async (data) => {
        tracking.queued.push(data);
      },
    },
    ids: { next: () => `scenariorun_${Math.random().toString(36).slice(2)}` },
    scenarios: declaringScenarios,
  });

  return service.execute({
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
        parameters: [{ name: "account_tier", defaultValue: "gold" }],
      },
    ],
    activeTargets: [{ type: "http", referenceId: "agent-1", runParameters }] as never,
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    simulatorModel: null,
    judgeModel: null,
  });
}

describe("given a target override no scenario in the run declares", () => {
  /** @scenario "A target override no scenario in the run declares is refused" */
  it("rejects the run before anything is scheduled", async () => {
    const tracking = { queued: [] as QueueSimulationRunCommandData[], started: false };

    await expect(execute({ seats: 12 }, tracking)).rejects.toMatchObject({
      code: "scenario_parameter_unknown",
    });

    expect(tracking.started).toBe(false);
    expect(tracking.queued).toHaveLength(0);
  });
});
