/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationRunnerService } from "../simulation-runner.service";

// Mock the scenario queue
vi.mock("../scenario.queue", () => ({
  scheduleScenarioRun: vi.fn().mockResolvedValue({
    id: "job_123",
    data: {},
  }),
  generateBatchRunId: () => "scenariobatch_test123",
}));

import { scheduleScenarioRun } from "../scenario.queue";

const mockScheduleScenarioRun = vi.mocked(scheduleScenarioRun);

describe("SimulationRunnerService", () => {
  let service: SimulationRunnerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = SimulationRunnerService.create();
  });

  describe("execute", () => {
    it("schedules a scenario job on the queue", async () => {
      const result = await service.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "scenariobatch_test123",
      });

      expect(mockScheduleScenarioRun).toHaveBeenCalledWith({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "scenariobatch_test123",
      });

      expect(result.success).toBe(true);
      expect(result.runId).toBe("job_123");
    });

    it("schedules http target jobs", async () => {
      await service.execute({
        projectId: "proj_456",
        scenarioId: "scen_456",
        target: { type: "http", referenceId: "agent_456" },
        setId: "set_456",
        batchRunId: "scenariobatch_http123",
      });

      expect(mockScheduleScenarioRun).toHaveBeenCalledWith({
        projectId: "proj_456",
        scenarioId: "scen_456",
        target: { type: "http", referenceId: "agent_456" },
        setId: "set_456",
        batchRunId: "scenariobatch_http123",
      });
    });

    it("throws error for invalid batchRunId", async () => {
      await expect(
        service.execute({
          projectId: "proj_123",
          scenarioId: "scen_123",
          target: { type: "prompt", referenceId: "prompt_123" },
          setId: "set_123",
          batchRunId: "",
        }),
      ).rejects.toThrow("Invalid batchRunId");
    });
  });
});
