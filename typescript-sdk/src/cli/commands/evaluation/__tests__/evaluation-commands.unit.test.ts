import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvaluationsApiError } from "@/client-sdk/services/evaluations/evaluations-api.service";

vi.mock("@/client-sdk/services/evaluations/evaluations-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@/client-sdk/services/evaluations/evaluations-api.service")>();
  return {
    ...actual,
    EvaluationsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
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

import { EvaluationsApiService } from "@/client-sdk/services/evaluations/evaluations-api.service";
import { runEvaluationCommand } from "../run";
import { evaluationStatusCommand } from "../status";

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

describe("runEvaluationCommand()", () => {
  let mockStartRun: ReturnType<typeof vi.fn>;
  let mockGetRunStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStartRun = vi.fn();
    mockGetRunStatus = vi.fn();
    vi.mocked(EvaluationsApiService).mockImplementation(() => ({
      startRun: mockStartRun,
      getRunStatus: mockGetRunStatus,
    }) as unknown as EvaluationsApiService);
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

      await runEvaluationCommand("quality-check", {});

      expect(mockStartRun).toHaveBeenCalledWith("quality-check");
    });
  });

  describe("when format is json", () => {
    it("outputs raw JSON", async () => {
      const result = {
        runId: "run_123",
        status: "running",
        total: 10,
      };
      mockStartRun.mockResolvedValue(result);

      await runEvaluationCommand("quality-check", { format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(result, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockStartRun.mockRejectedValue(
        new EvaluationsApiError("Not found", "start evaluation run"),
      );

      await expect(
        runEvaluationCommand("nonexistent", {}),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("evaluationStatusCommand()", () => {
  let mockGetRunStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunStatus = vi.fn();
    vi.mocked(EvaluationsApiService).mockImplementation(() => ({
      startRun: vi.fn(),
      getRunStatus: mockGetRunStatus,
    }) as unknown as EvaluationsApiService);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when status is returned", () => {
    it("calls getRunStatus with the run ID", async () => {
      mockGetRunStatus.mockResolvedValue({
        runId: "run_123",
        status: "completed",
        progress: 10,
        total: 10,
      });

      await evaluationStatusCommand("run_123");

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

      await evaluationStatusCommand("run_123", { format: "json" });

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(status, null, 2),
      );
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGetRunStatus.mockRejectedValue(
        new EvaluationsApiError("Not found", "get run status"),
      );

      await expect(
        evaluationStatusCommand("nonexistent"),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});
