import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  ExperimentsApiServiceError,
  ExperimentsApiService,
} from "@/client-sdk/services/experiments/experiments-api.service";

vi.mock("@/client-sdk/services/experiments/experiments-api.service", async (importOriginal) => {
  const actual = await importOriginal<typeof experimentsApiServiceModule>();
  return {
    ...actual,
    ExperimentsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    text: "",
  }),
}));

import type * as experimentsApiServiceModule from "@/client-sdk/services/experiments/experiments-api.service";

import { rowPassRatesOf } from "../rowPassRates";
import { runExperimentCommand } from "../run";
import { experimentStatusCommand } from "../status";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

describe("runExperimentCommand()", () => {
  let mockStartRun: ReturnType<typeof vi.fn>;
  let mockGetRunStatus: ReturnType<typeof vi.fn>;
  let mockGetRunResults: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStartRun = vi.fn();
    mockGetRunStatus = vi.fn();
    mockGetRunResults = vi.fn();
    vi.mocked(ExperimentsApiService).mockImplementation(function () {
      return {
        startRun: mockStartRun,
        getRunStatus: mockGetRunStatus,
        getRunResults: mockGetRunResults,
      } as unknown as ExperimentsApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when run starts successfully", () => {
    it("calls startRun with the slug", async () => {
      mockStartRun.mockResolvedValue({
        runId: "run_123",
        status: "running",
        total: 10,
      });

      await runExperimentCommand("quality-check", {});

      expect(mockStartRun).toHaveBeenCalledWith("quality-check", {
        parameters: undefined,
      });
    });
  });

  describe("when --param pairs are given", () => {
    /** @scenario "The experiment run command passes param flags the same way suite run does" */
    it("starts the run with those names resolved to the flags' values", async () => {
      mockStartRun.mockResolvedValue({
        runId: "run_123",
        status: "running",
        total: 10,
      });

      await runExperimentCommand("quality-check", {
        param: ["account_tier=gold", "seats=12", "beta=true"],
      });

      expect(mockStartRun).toHaveBeenCalledWith("quality-check", {
        parameters: { account_tier: "gold", seats: 12, beta: true },
      });
    });
  });

  describe("when --concurrency is given", () => {
    /** @scenario "The experiment run command passes its concurrency flag on the run" */
    it("starts the run with that concurrency", async () => {
      mockStartRun.mockResolvedValue({ runId: "run_123", status: "running", total: 10 });

      await runExperimentCommand("quality-check", { concurrency: "1" });

      expect(mockStartRun).toHaveBeenCalledWith("quality-check", {
        parameters: undefined,
        concurrency: 1,
      });
    });
  });

  describe("when --dataset-version is given", () => {
    it("starts the run pinned to that dataset version", async () => {
      mockStartRun.mockResolvedValue({ runId: "run_123", status: "running", total: 10 });

      await runExperimentCommand("quality-check", { datasetVersion: 2 });

      expect(mockStartRun).toHaveBeenCalledWith("quality-check", {
        parameters: undefined,
        datasetVersion: 2,
      });
    });
  });

  describe("when --concurrency is outside 1 to 24", () => {
    for (const value of ["0", "25", "1.5", "many"]) {
      /** @scenario "The experiment run command refuses a concurrency outside 1 to 24" */
      it(`refuses "${value}" instead of starting a run`, async () => {
        await expect(runExperimentCommand("quality-check", { concurrency: value })).rejects.toThrow(
          ProcessExitError,
        );

        expect(mockStartRun).not.toHaveBeenCalled();
      });
    }
  });

  describe("when --repeat is given", () => {
    /** @scenario "The experiment run command passes its repeat flag on the run" */
    it("starts the run with that repeat", async () => {
      mockStartRun.mockResolvedValue({ runId: "run_123", status: "running", total: 6 });

      await runExperimentCommand("quality-check", { repeat: "3" });

      expect(mockStartRun).toHaveBeenCalledWith("quality-check", {
        parameters: undefined,
        repeat: 3,
      });
    });
  });

  describe("when --repeat is not a whole number from 1 to 5", () => {
    for (const value of ["0", "6", "1.5", "many"]) {
      /** @scenario "The experiment run command refuses a repeat that is not a whole number from 1 to 5" */
      it(`refuses "${value}" instead of starting a run`, async () => {
        await expect(runExperimentCommand("quality-check", { repeat: value })).rejects.toThrow(
          ProcessExitError,
        );

        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("--repeat takes a whole number from 1 to 5"),
        );
        expect(mockStartRun).not.toHaveBeenCalled();
      });
    }
  });

  describe("when a repeated run is waited for and completes", () => {
    /** @scenario "A waited repeated run prints the pass rate of every dataset row" */
    it("prints and returns each dataset row's pass rate over its repetitions", async () => {
      mockStartRun.mockResolvedValue({ runId: "run_123", status: "running", total: 6 });
      mockGetRunStatus.mockResolvedValue({
        runId: "run_123",
        status: "completed",
        progress: 6,
        total: 6,
      });
      const verdicts = [true, false, true, true, true, true];
      mockGetRunResults.mockResolvedValue({
        experimentId: "experiment_1",
        runId: "run_123",
        projectId: "project_1",
        repeat: 3,
        targets: [{ id: "target_a", name: "support-prompt" }],
        dataset: verdicts.map((_, index) => ({ index, targetId: "target_a", entry: {} })),
        evaluations: verdicts.map((passed, index) => ({
          evaluator: "exact",
          targetId: "target_a",
          status: "processed",
          index,
          passed,
        })),
        timestamps: { createdAt: 1, updatedAt: 2, finishedAt: 2 },
        completeness: {
          complete: true,
          dataset: { received: 6, expected: 6 },
          evaluations: { received: 6, expected: 6 },
        },
      });

      const result = await runExperimentCommand("quality-check", { repeat: "3", wait: true });
      result?.table?.();

      const printed = vi
        .mocked(console.log)
        .mock.calls.map((call) => call.join(" "))
        .join("\n");
      expect(printed).toContain("Row 1 · support-prompt:");
      expect(printed).toContain("2/3 passed (67%)");
      expect(printed).toContain("3/3 passed (100%)");
      expect(result?.data).toMatchObject({
        rowPassRates: [
          { row: 1, targetId: "target_a", passed: 2, graded: 3, repeat: 3 },
          { row: 2, targetId: "target_a", passed: 3, graded: 3, repeat: 3 },
        ],
      });
    });
  });

  describe("when a --param pair has no equals sign", () => {
    it("refuses the command instead of starting a run", async () => {
      await expect(
        runExperimentCommand("quality-check", { param: ["account_tier"] }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockStartRun).not.toHaveBeenCalled();
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const runResult = {
        runId: "run_123",
        status: "running",
        total: 10,
      };
      mockStartRun.mockResolvedValue(runResult);

      const result = await runExperimentCommand("quality-check", {});

      expect(result?.data).toEqual(runResult);
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockStartRun.mockRejectedValue(
        new ExperimentsApiServiceError("Not found", "start evaluation run"),
      );

      await expect(runExperimentCommand("nonexistent", {})).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("experimentStatusCommand()", () => {
  let mockGetRunStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunStatus = vi.fn();
    vi.mocked(ExperimentsApiService).mockImplementation(function () {
      return {
        startRun: vi.fn(),
        getRunStatus: mockGetRunStatus,
        getRunResults: vi
          .fn()
          .mockRejectedValue(new ExperimentsApiServiceError("Run not found", "get run results")),
        listRuns: vi.fn().mockResolvedValue({ runs: [{ runId: "run_123" }] }),
      } as unknown as ExperimentsApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when status is returned", () => {
    it("calls getRunStatus with the pinned run id", async () => {
      mockGetRunStatus.mockResolvedValue({
        runId: "run_123",
        status: "completed",
        progress: 10,
        total: 10,
      });

      await experimentStatusCommand("doc-qa", { runId: "run_123" });

      expect(mockGetRunStatus).toHaveBeenCalledWith("run_123");
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const status = {
        runId: "run_123",
        status: "completed",
        progress: 10,
        total: 10,
        summary: { completedCells: 10, duration: 5000 },
      };
      mockGetRunStatus.mockResolvedValue(status);

      const result = await experimentStatusCommand("doc-qa", { runId: "run_123" });

      expect(result?.data).toEqual(status);
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGetRunStatus.mockRejectedValue(
        new ExperimentsApiServiceError("Not found", "get run status"),
      );

      await expect(experimentStatusCommand("doc-qa", { runId: "nonexistent" })).rejects.toThrow(
        ProcessExitError,
      );
    });
  });
});

describe("rowPassRatesOf()", () => {
  describe("given a repetition whose target errored and one with no pass or fail verdict", () => {
    /** @scenario "A run that errors counts as a failed repetition" */
    it("counts the error as failed and leaves the ungraded repetition out", () => {
      const rates = rowPassRatesOf({
        repeat: 3,
        results: {
          dataset: [
            { index: 0, targetId: "target_a", entry: {} },
            { index: 1, targetId: "target_a", entry: {}, error: "timed out" },
            { index: 2, targetId: "target_a", entry: {} },
          ],
          evaluations: [
            {
              evaluator: "exact",
              targetId: "target_a",
              status: "processed",
              index: 0,
              passed: true,
            },
            { evaluator: "score", targetId: "target_a", status: "processed", index: 2, score: 0.4 },
          ],
        },
      });

      expect(rates).toEqual([
        {
          row: 1,
          targetId: "target_a",
          targetName: null,
          passed: 1,
          graded: 2,
          repeat: 3,
        },
      ]);
    });
  });
});
