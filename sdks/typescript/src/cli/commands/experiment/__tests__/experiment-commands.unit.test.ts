import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockStartRun = vi.fn();
    mockGetRunStatus = vi.fn();
    vi.mocked(ExperimentsApiService).mockImplementation(function () {
      return {
        startRun: mockStartRun,
        getRunStatus: mockGetRunStatus,
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

  describe("when --wait sees the run complete", () => {
    const failingVerdict = [
      { evaluatorId: "ev_1", name: "exact_match", passed: 2, failed: 1, passRate: 66.7 },
    ];
    const passingVerdict = [
      { evaluatorId: "ev_1", name: "exact_match", passed: 3, failed: 0, passRate: 100 },
    ];
    const crashedVerdict = [
      { evaluatorId: "ev_1", name: "exact_match", passed: 0, failed: 0, errored: 3, passRate: 0 },
    ];
    const completedWith = (summary: Record<string, unknown>) => ({
      runId: "run_123",
      status: "completed",
      progress: 3,
      total: 3,
      summary: { runId: "run_123", totalCells: 3, completedCells: 3, duration: 900, ...summary },
    });

    beforeEach(() => {
      process.exitCode = undefined;
      mockStartRun.mockResolvedValue({ runId: "run_123", status: "running", total: 3 });
    });

    afterEach(() => {
      process.exitCode = undefined;
    });

    /** @scenario "The CLI leaves a completed run green by default, as before" */
    it("leaves the job green by default, even with failures", async () => {
      mockGetRunStatus.mockResolvedValue(
        completedWith({ failedCells: 1, evaluators: failingVerdict }),
      );

      const result = await runExperimentCommand("quality-check", { wait: true });

      expect(result?.data).toMatchObject({ status: "completed" });
      expect(process.exitCode).toBeUndefined();
    });

    /** @scenario "The CLI fails a waited run on a failed evaluation when asked" */
    it("prints the document and fails the job on a failed evaluation when opted in", async () => {
      mockGetRunStatus.mockResolvedValue(
        completedWith({ failedCells: 0, evaluators: failingVerdict }),
      );

      const result = await runExperimentCommand("quality-check", {
        wait: true,
        failOnEvaluatorFailures: true,
      });

      expect(result?.data).toMatchObject({ status: "completed" });
      expect(process.exitCode).toBe(1);
    });

    /** @scenario "The CLI opt-in also fails a waited run on an errored cell" */
    it("fails the job on an errored cell when opted in", async () => {
      mockGetRunStatus.mockResolvedValue(
        completedWith({ failedCells: 1, evaluators: passingVerdict }),
      );

      await runExperimentCommand("quality-check", { wait: true, failOnEvaluatorFailures: true });

      expect(process.exitCode).toBe(1);
    });

    /** @scenario "The CLI opt-in fails a waited run whose evaluator crashed" */
    it("fails the job when an evaluator errored on every row and opted in", async () => {
      mockGetRunStatus.mockResolvedValue(
        completedWith({ failedCells: 0, evaluators: crashedVerdict }),
      );

      await runExperimentCommand("quality-check", { wait: true, failOnEvaluatorFailures: true });

      expect(process.exitCode).toBe(1);
    });

    it("shows a crashed evaluator's errors and no pass rate in the table summary", async () => {
      mockGetRunStatus.mockResolvedValue(
        completedWith({ failedCells: 0, evaluators: crashedVerdict }),
      );
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      const result = await runExperimentCommand("quality-check", { wait: true });
      result?.table?.();

      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toMatch(/exact_match:.*0 passed, 0 failed, .*3 errored.*\(no verdicts\)/);
    });

    /** @scenario "The CLI opt-in fails a waited run whose summary has no evaluator results" */
    it("fails the job when opted in and the summary has no evaluator results", async () => {
      mockGetRunStatus.mockResolvedValue(completedWith({ failedCells: 0 }));

      const result = await runExperimentCommand("quality-check", {
        wait: true,
        failOnEvaluatorFailures: true,
      });

      expect(result?.data).toMatchObject({ status: "completed" });
      expect(process.exitCode).toBe(1);
    });

    /** @scenario "The CLI opt-in leaves a clean run green" */
    it("leaves a clean run green when opted in", async () => {
      mockGetRunStatus.mockResolvedValue(
        completedWith({ failedCells: 0, evaluators: passingVerdict }),
      );

      await runExperimentCommand("quality-check", { wait: true, failOnEvaluatorFailures: true });

      expect(process.exitCode).toBeUndefined();
    });

    it("lists each evaluator's passed and failed counts in the table summary", async () => {
      mockGetRunStatus.mockResolvedValue(
        completedWith({ failedCells: 0, evaluators: failingVerdict }),
      );
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      const result = await runExperimentCommand("quality-check", { wait: true });
      result?.table?.();

      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toMatch(/exact_match:.*2 passed, .*1 failed.*\(66\.7%\)/);
    });

    /** @scenario "A run that fails on the server fails the job" */
    it("exits 1 when the server marks the run failed", async () => {
      mockGetRunStatus.mockResolvedValue({
        runId: "run_123",
        status: "failed",
        progress: 1,
        total: 3,
      });

      await expect(runExperimentCommand("quality-check", { wait: true })).rejects.toThrow(
        ProcessExitError,
      );
    });
  });

  describe("when --fail-on-evaluator-failures is given without --wait", () => {
    /** @scenario "The evaluator flag without --wait is rejected" */
    it("rejects the flag before starting a run", async () => {
      await expect(
        runExperimentCommand("quality-check", { failOnEvaluatorFailures: true }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockStartRun).not.toHaveBeenCalled();
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
