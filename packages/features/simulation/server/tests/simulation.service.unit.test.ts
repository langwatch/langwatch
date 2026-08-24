import { describe, expect, it } from "vitest";
import { NullSimulationRepository } from "../src/repositories/simulation.repository";
import { SimulationService } from "../src/services/simulation.service";

describe("SimulationService", () => {
  it("delegates run reads through Simulation's own repository", async () => {
    const service = new SimulationService(new NullSimulationRepository());

    await expect(service.tryGetScenarioRunData({ projectId: "project_1", scenarioRunId: "run_1" })).resolves.toBeNull();
    await expect(service.getRunIdsForSet({ projectId: "project_1", scenarioSetId: "set_1" })).resolves.toEqual({ runIds: [], reachedCap: false });
  });
});
