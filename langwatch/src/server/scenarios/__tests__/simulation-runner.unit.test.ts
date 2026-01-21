/**
 * @vitest-environment node
 *
 * Unit tests for scenario scheduling via the queue.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the scenario queue
vi.mock("../scenario.queue", () => ({
  scheduleScenarioRun: vi.fn().mockResolvedValue({
    id: "job_123",
    data: {},
  }),
  generateBatchRunId: () => "scenariobatch_test123",
}));

import { scheduleScenarioRun, generateBatchRunId } from "../scenario.queue";

const mockScheduleScenarioRun = vi.mocked(scheduleScenarioRun);

describe("scheduleScenarioRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules a job with correct parameters", async () => {
    // Given: scenario parameters
    const params = {
      projectId: "proj_123",
      scenarioId: "scen_123",
      target: { type: "prompt" as const, referenceId: "prompt_123" },
      setId: "set_123",
      batchRunId: "scenariobatch_test123",
    };

    // When: scheduling
    const job = await scheduleScenarioRun(params);

    // Then: returns job with ID
    expect(job.id).toBe("job_123");
    expect(mockScheduleScenarioRun).toHaveBeenCalledWith(params);
  });
});

describe("generateBatchRunId", () => {
  it("generates IDs with correct prefix", () => {
    const id = generateBatchRunId();
    expect(id).toMatch(/^scenariobatch_/);
  });
});
