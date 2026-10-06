import type {
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationFinishRun,
  SimulationMessageSnapshot,
  SimulationQueueRun,
  SimulationStartRun,
  SimulationTextMessageEnd,
  SimulationTextMessageStart,
  RecordEvaluationsCommandData,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { SimulationService } from "../../services/simulation.service.ts";
import { SimulationExecutionRepository } from "../simulation-execution.repository.ts";
import { NullSimulationRepository } from "../simulation.repository.ts";

class RecordingExecution extends SimulationExecutionRepository {
  queue: SimulationQueueRun | undefined;
  finished: SimulationFinishRun | undefined;
  async queueRun(input: SimulationQueueRun): Promise<void> {
    this.queue = input;
  }
  async startRun(_input: SimulationStartRun): Promise<void> {}
  async messageSnapshot(_input: SimulationMessageSnapshot): Promise<void> {}
  async textMessageStart(_input: SimulationTextMessageStart): Promise<void> {}
  async textMessageEnd(_input: SimulationTextMessageEnd): Promise<void> {}
  async finishRun(input: SimulationFinishRun): Promise<void> {
    this.finished = input;
  }
  async cancelRun(_input: SimulationCancelRun): Promise<void> {}
  async deleteRun(_input: SimulationDeleteRun): Promise<void> {}

  async recordEvaluations(_input: RecordEvaluationsCommandData): Promise<void> {}

  async recordAgentInstance(): Promise<void> {}

  async recordCutAtLimit(): Promise<void> {}
}

describe("SimulationService", () => {
  it("delegates run reads through Simulation's own repository", async () => {
    const service = SimulationService.create(
      new NullSimulationRepository(),
      new RecordingExecution(),
    );

    await expect(
      service.findScenarioRunData({ projectId: "project_1", scenarioRunId: "run_1" }),
    ).resolves.toBeNull();
    await expect(
      service.getRunIdsForSet({ projectId: "project_1", scenarioSetId: "set_1" }),
    ).resolves.toEqual({ runIds: [], reachedCap: false });
  });

  it("validates and dispatches execution through Simulation's port", async () => {
    const execution = new RecordingExecution();
    const service = SimulationService.create(new NullSimulationRepository(), execution);

    await service.queueRun({
      tenantId: "project_1",
      scenarioRunId: "run_1",
      scenarioId: "scenario_1",
      batchRunId: "batch_1",
      scenarioSetId: "set_1",
      occurredAt: 1,
    });

    expect(execution.queue?.scenarioRunId).toBe("run_1");
  });

  describe("given a command that is not a valid finish", () => {
    it("refuses it before the execution port sees anything", () => {
      const execution = new RecordingExecution();
      const service = SimulationService.create(new NullSimulationRepository(), execution);

      // wrong-typed input: the command arrives from a transport that has not been validated yet
      const notAFinish = { tenantId: "project_1" } as unknown as SimulationFinishRun;

      expect(() => service.finishRun(notAFinish)).toThrow(/scenarioRunId/);
      expect(execution.finished).toBeUndefined();
    });
  });

  describe("given a deployment whose analytical store is disabled", () => {
    const service = SimulationService.create(
      new NullSimulationRepository(),
      new RecordingExecution(),
    );
    const project = { projectId: "project_1" };

    /** @scenario "A disabled analytical store remains a safe empty read" */
    it("answers every run-history and run-identifier read with its empty result", async () => {
      await expect(
        service.findScenarioRunData({ ...project, scenarioRunId: "run_1" }),
      ).resolves.toBeNull();
      await expect(
        service.getRunDataForScenarioSet({ ...project, scenarioSetId: "set_1", limit: 20 }),
      ).resolves.toEqual({ runs: [], hasMore: false });
      await expect(
        service.getAllRunDataForScenarioSet({ ...project, scenarioSetId: "set_1" }),
      ).resolves.toEqual([]);
      await expect(
        service.getRunIdsForSet({ ...project, scenarioSetId: "set_1" }),
      ).resolves.toEqual({
        runIds: [],
        reachedCap: false,
      });
      await expect(
        service.getDistinctExternalSetIds({ projectIds: [project.projectId] }),
      ).resolves.toEqual(new Set());
    });
  });
});
