import { describe, expect, it } from "vitest";
import type {
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationFinishRun,
  SimulationMessageSnapshot,
  SimulationQueueRun,
  SimulationStartRun,
  SimulationTextMessageEnd,
  SimulationTextMessageStart,
} from "@langwatch/simulation-contract";
import { SimulationExecutionPort } from "../src/ports/simulation-execution.port";
import { NullSimulationRepository } from "../src/repositories/simulation.repository";
import { SimulationService } from "../src/services/simulation.service";

class RecordingExecutionPort extends SimulationExecutionPort {
  queue: SimulationQueueRun | undefined;
  async queueRun(input: SimulationQueueRun): Promise<void> {
    this.queue = input;
  }
  async startRun(_input: SimulationStartRun): Promise<void> {}
  async messageSnapshot(_input: SimulationMessageSnapshot): Promise<void> {}
  async textMessageStart(_input: SimulationTextMessageStart): Promise<void> {}
  async textMessageEnd(_input: SimulationTextMessageEnd): Promise<void> {}
  async finishRun(_input: SimulationFinishRun): Promise<void> {}
  async cancelRun(_input: SimulationCancelRun): Promise<void> {}
  async deleteRun(_input: SimulationDeleteRun): Promise<void> {}
}

describe("SimulationService", () => {
  it("delegates run reads through Simulation's own repository", async () => {
    const service = SimulationService.create(
      new NullSimulationRepository(),
      new RecordingExecutionPort(),
    );

    await expect(
      service.tryGetScenarioRunData({ projectId: "project_1", scenarioRunId: "run_1" }),
    ).resolves.toBeNull();
    await expect(
      service.getRunIdsForSet({ projectId: "project_1", scenarioSetId: "set_1" }),
    ).resolves.toEqual({ runIds: [], reachedCap: false });
  });

  it("validates and dispatches execution through Simulation's port", async () => {
    const execution = new RecordingExecutionPort();
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
});
