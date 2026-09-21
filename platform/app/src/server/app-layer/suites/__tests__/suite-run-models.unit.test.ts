/**
 * @vitest-environment node
 *
 * What a queued suite run records about the models it will run on. The queued
 * command is the only place the stamp happens, so this reads it straight off
 * the command the service dispatches.
 *
 * @see specs/scenarios/resolved-run-models-on-runs.feature
 */

import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { RunModelsResolver } from "~/server/scenarios/run-models.resolver";
import { NullSuiteRunReadRepository } from "../repositories/suite-run.repository";
import { SuiteRunService } from "../suite-run.service";

const scenarioId = "scenario_refund";

/** Starts a run of one case and returns the queued command it dispatched. */
async function queuedCommandFor(params: {
  simulatorModel?: string | null;
  judgeModel?: string | null;
  resolveRunModels?: RunModelsResolver;
}): Promise<QueueRunCommandData> {
  const queued: QueueRunCommandData[] = [];
  const service = new SuiteRunService(new NullSuiteRunReadRepository(), {
    startSuiteRun: async () => {},
    queueSimulationRun: async (data) => {
      queued.push(data);
    },
    resolveRunModels: params.resolveRunModels,
  });

  await service.startRun({
    suiteId: `suite-${nanoid()}`,
    projectId: `project-${nanoid()}`,
    activeScenarioIds: [scenarioId],
    scenarioNameMap: new Map([[scenarioId, "Refund flow"]]),
    scenarioVersionMap: new Map([[scenarioId, 2]]),
    activeTargets: [{ type: "http", referenceId: "agent-1" }],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${nanoid()}`,
    simulatorModel: params.simulatorModel ?? null,
    judgeModel: params.judgeModel ?? null,
  });

  const command = queued[0];
  if (!command) throw new Error("startRun dispatched no queued command");
  return command;
}

/** The reserved namespace of a queued command. */
function reservedNamespace(
  command: QueueRunCommandData,
): Record<string, unknown> {
  return (command.metadata as { langwatch: Record<string, unknown> }).langwatch;
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
              {
                simulatorModel: "openai/gpt-5-mini",
                judgeModel: "openai/gpt-5",
              },
            ]),
          ),
      });

      const langwatch = reservedNamespace(command);
      expect(langwatch.resolvedSimulatorModel).toBe("openai/gpt-5-mini");
      expect(langwatch.resolvedJudgeModel).toBe("openai/gpt-5");
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

      const langwatch = reservedNamespace(command);
      expect(langwatch.judgeModel).toBe("openai/gpt-5");
      expect(langwatch.resolvedJudgeModel).toBe("openai/gpt-5");
    });
  });

  describe("when the project has no model set for a role", () => {
    /** @scenario "A project with no model set for a role records no resolved model" */
    it("still queues the run, recording no resolved model", async () => {
      const command = await queuedCommandFor({
        resolveRunModels: async () => new Map(),
      });

      const langwatch = reservedNamespace(command);
      expect(langwatch).not.toHaveProperty("resolvedSimulatorModel");
      expect(langwatch).not.toHaveProperty("resolvedJudgeModel");
      expect(command.scenarioId).toBe(scenarioId);
    });
  });
});
