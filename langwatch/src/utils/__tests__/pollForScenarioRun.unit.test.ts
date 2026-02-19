/**
 * Unit tests for pollForScenarioRun utility.
 * @see specs/scenarios/scenario-failure-handler.feature "Polling Logic Improvements"
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { pollForScenarioRun } from "../pollForScenarioRun";

interface ScenarioRun {
  scenarioRunId: string;
  status?: string;
  messages?: unknown[];
}

interface PollForRunParams {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
}

type BatchRunDataResult =
  | { changed: false }
  | { changed: true; runs: ScenarioRun[] };

type FetchBatchRunData = (params: PollForRunParams) => Promise<BatchRunDataResult>;

describe("pollForScenarioRun", () => {
  const baseParams = {
    projectId: "proj_123",
    scenarioSetId: "set_456",
    batchRunId: "batch_789",
  };

  let fetchBatchRunData: Mock<FetchBatchRunData>;

  beforeEach(() => {
    fetchBatchRunData = vi.fn<FetchBatchRunData>();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns success when RUN_STARTED exists with IN_PROGRESS status", async () => {
    // Given: a scenario run exists with IN_PROGRESS status and no messages
    fetchBatchRunData.mockResolvedValue({
      changed: true,
      runs: [{ scenarioRunId: "run_123", status: "IN_PROGRESS", messages: [] }],
    });

    // When: pollForScenarioRun fetches the batch run data
    const resultPromise = pollForScenarioRun(fetchBatchRunData, baseParams);

    // Need to flush promises since the first fetch is immediate
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;

    // Then: it returns success with scenarioRunId "run_123"
    expect(result).toEqual({
      success: true,
      scenarioRunId: "run_123",
    });

    // And: does not continue polling (only one fetch call)
    expect(fetchBatchRunData).toHaveBeenCalledTimes(1);
  });

  it("returns error when run has ERROR status", async () => {
    // Given: a scenario run exists with ERROR status
    fetchBatchRunData.mockResolvedValue({
      changed: true,
      runs: [{ scenarioRunId: "run_123", status: "ERROR", messages: [] }],
    });

    // When: pollForScenarioRun fetches the batch run data
    const resultPromise = pollForScenarioRun(fetchBatchRunData, baseParams);
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;

    // Then: it returns failure with error "run_error"
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("run_error");
      // And: includes scenarioRunId "run_123"
      expect(result.scenarioRunId).toBe("run_123");
    }
  });

  it("returns error when run has FAILED status", async () => {
    // Given: a scenario run exists with FAILED status
    fetchBatchRunData.mockResolvedValue({
      changed: true,
      runs: [{ scenarioRunId: "run_123", status: "FAILED", messages: [] }],
    });

    // When: pollForScenarioRun fetches the batch run data
    const resultPromise = pollForScenarioRun(fetchBatchRunData, baseParams);
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;

    // Then: it returns failure with error "run_error"
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("run_error");
      // And: includes scenarioRunId "run_123"
      expect(result.scenarioRunId).toBe("run_123");
    }
  });

  it("continues polling when no runs exist yet and times out", async () => {
    // Given: no scenario runs exist for the batchRunId
    fetchBatchRunData.mockResolvedValue({ changed: true, runs: [] });

    // When: pollForScenarioRun is called
    const resultPromise = pollForScenarioRun(fetchBatchRunData, baseParams);

    // Advance timers to simulate the polling (30 seconds = 60 attempts at 500ms)
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    const result = await resultPromise;

    // Then: it continues polling until timeout
    // And: returns failure with error "timeout" after max attempts
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("timeout");
    }
  });

  it("returns success when run exists with SUCCESS status", async () => {
    // Given: a completed run with SUCCESS status
    fetchBatchRunData.mockResolvedValue({
      changed: true,
      runs: [{ scenarioRunId: "run_123", status: "SUCCESS", messages: [] }],
    });

    // When: pollForScenarioRun fetches the batch run data
    const resultPromise = pollForScenarioRun(fetchBatchRunData, baseParams);
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;

    // Then: it returns success (terminal success state)
    expect(result).toEqual({
      success: true,
      scenarioRunId: "run_123",
    });
  });

  it("returns success when run has messages even without terminal status", async () => {
    // Given: a run with messages but still IN_PROGRESS
    fetchBatchRunData.mockResolvedValue({
      changed: true,
      runs: [
        {
          scenarioRunId: "run_123",
          status: "IN_PROGRESS",
          messages: [{ role: "user", content: "Hello" }],
        },
      ],
    });

    // When: pollForScenarioRun fetches the batch run data
    const resultPromise = pollForScenarioRun(fetchBatchRunData, baseParams);
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;

    // Then: it returns success because there are messages to display
    expect(result).toEqual({
      success: true,
      scenarioRunId: "run_123",
    });
  });
});
