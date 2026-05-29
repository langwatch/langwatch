import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as ExperimentsApiModule from "@/client-sdk/services/experiments/experiments-api.service";

const oraMocks = vi.hoisted(() => ({
  fail: vi.fn(),
  succeed: vi.fn(),
}));

vi.mock("@/client-sdk/services/experiments/experiments-api.service", async (importOriginal) => {
  const actual = await importOriginal<typeof ExperimentsApiModule>();
  return {
    ...actual,
    ExperimentsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: oraMocks.succeed,
    fail: oraMocks.fail,
    warn: vi.fn(),
    text: "",
  }),
}));

import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { experimentStatusCommand } from "../status";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // suppress
};

describe("experimentStatusCommand()", () => {
  let mockGetRunStatus: ReturnType<typeof vi.fn>;
  let mockGetRunResults: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunStatus = vi.fn();
    mockGetRunResults = vi.fn();
    vi.mocked(ExperimentsApiService).mockImplementation(() => ({
      startRun: vi.fn(),
      getRunStatus: mockGetRunStatus,
      getRunResults: mockGetRunResults,
    }) as unknown as ExperimentsApiService);
    logSpy = vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given the run state exists in Redis", () => {
    it("reports the status from the status endpoint", async () => {
      mockGetRunStatus.mockResolvedValue({
        runId: "run_1",
        status: "completed",
        progress: 3,
        total: 3,
      });
      await experimentStatusCommand("run_1");
      expect(mockGetRunStatus).toHaveBeenCalledWith("run_1");
      expect(mockGetRunResults).not.toHaveBeenCalled();
      const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(printed).toContain("3/3 cells");
    });
  });

  describe("given an SDK-logged run with no Redis state", () => {
    it("falls back to the results endpoint when experiment slug is provided", async () => {
      mockGetRunStatus.mockRejectedValue(new Error("Run not found"));
      mockGetRunResults.mockResolvedValue({
        progress: 5,
        total: 5,
        dataset: [1, 2, 3, 4, 5],
        timestamps: {
          createdAt: 1,
          updatedAt: 2,
          finishedAt: 3,
          stoppedAt: null,
        },
      });
      await experimentStatusCommand("sdk_run", { experiment: "doc-qa" });
      expect(mockGetRunResults).toHaveBeenCalledWith({
        runId: "sdk_run",
        experimentSlug: "doc-qa",
      });
      const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(printed).toContain("5/5 cells");
    });

    it("exits 1 when no slug is provided to enable the fallback", async () => {
      mockGetRunStatus.mockRejectedValue(new Error("Run not found"));
      await expect(experimentStatusCommand("sdk_run")).rejects.toMatchObject({
        code: 1,
      });
      expect(mockGetRunResults).not.toHaveBeenCalled();
    });

    it("keeps runId in the json fallback output for schema parity", async () => {
      mockGetRunStatus.mockRejectedValue(new Error("Run not found"));
      mockGetRunResults.mockResolvedValue({
        progress: 5,
        total: 5,
        dataset: [1, 2, 3, 4, 5],
        timestamps: { createdAt: 1, updatedAt: 2, finishedAt: 3, stoppedAt: null },
      });
      await experimentStatusCommand("sdk_run", {
        experiment: "doc-qa",
        format: "json",
      });
      const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      const payload = JSON.parse(printed);
      expect(payload.runId).toBe("sdk_run");
    });

    it("propagates a real fallback error instead of masking it as not-found", async () => {
      mockGetRunStatus.mockRejectedValue(new Error("Run not found"));
      mockGetRunResults.mockRejectedValue(new Error("get run results: 500 Internal Server Error"));
      await expect(
        experimentStatusCommand("sdk_run", { experiment: "doc-qa" }),
      ).rejects.toMatchObject({ code: 1 });
    });
  });
});
