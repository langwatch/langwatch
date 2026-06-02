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
  let mockListRuns: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunStatus = vi.fn();
    mockGetRunResults = vi.fn();
    mockListRuns = vi.fn().mockResolvedValue({
      runs: [{ runId: "latest_run" }, { runId: "older_run" }],
    });
    vi.mocked(ExperimentsApiService).mockImplementation(() => ({
      startRun: vi.fn(),
      getRunStatus: mockGetRunStatus,
      getRunResults: mockGetRunResults,
      listRuns: mockListRuns,
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

  describe("given an experiment slug with no run id", () => {
    it("resolves the latest run and reports its status", async () => {
      mockGetRunStatus.mockResolvedValue({
        runId: "latest_run",
        status: "completed",
        progress: 3,
        total: 3,
      });
      await experimentStatusCommand("doc-qa");
      expect(mockListRuns).toHaveBeenCalledWith({
        experimentSlug: "doc-qa",
        pageSize: 1,
      });
      expect(mockGetRunStatus).toHaveBeenCalledWith("latest_run");
      const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(printed).toContain("3/3 cells");
    });

    it("exits 1 when the experiment has no runs", async () => {
      mockListRuns.mockResolvedValue({ runs: [] });
      await expect(experimentStatusCommand("doc-qa")).rejects.toMatchObject({
        code: 1,
      });
      expect(mockGetRunStatus).not.toHaveBeenCalled();
    });
  });

  describe("given a pinned --run-id", () => {
    it("reports the live status for that run", async () => {
      mockGetRunStatus.mockResolvedValue({
        runId: "run_1",
        status: "completed",
        progress: 3,
        total: 3,
      });
      await experimentStatusCommand("doc-qa", { runId: "run_1" });
      expect(mockListRuns).not.toHaveBeenCalled();
      expect(mockGetRunStatus).toHaveBeenCalledWith("run_1");
      expect(mockGetRunResults).not.toHaveBeenCalled();
    });
  });

  describe("given an SDK-logged run with no Redis state", () => {
    it("falls back to the results endpoint and derives status", async () => {
      mockGetRunStatus.mockRejectedValue(new Error("Run not found"));
      mockGetRunResults.mockResolvedValue({
        progress: 5,
        total: 5,
        dataset: [1, 2, 3, 4, 5],
        timestamps: { createdAt: 1, updatedAt: 2, finishedAt: 3, stoppedAt: null },
      });
      await experimentStatusCommand("doc-qa", { runId: "sdk_run" });
      expect(mockGetRunResults).toHaveBeenCalledWith({
        runId: "sdk_run",
        experimentSlug: "doc-qa",
      });
      const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(printed).toContain("5/5 cells");
    });

    it("keeps runId in the json fallback output for schema parity", async () => {
      mockGetRunStatus.mockRejectedValue(new Error("Run not found"));
      mockGetRunResults.mockResolvedValue({
        progress: 5,
        total: 5,
        dataset: [1, 2, 3, 4, 5],
        timestamps: { createdAt: 1, updatedAt: 2, finishedAt: 3, stoppedAt: null },
      });
      await experimentStatusCommand("doc-qa", {
        runId: "sdk_run",
        format: "json",
      });
      const printed = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      const payload = JSON.parse(printed);
      expect(payload.runId).toBe("sdk_run");
    });

    it("propagates a real fallback error instead of masking it as not-found", async () => {
      mockGetRunStatus.mockRejectedValue(new Error("Run not found"));
      mockGetRunResults.mockRejectedValue(
        new Error("get run results: 500 Internal Server Error"),
      );
      await expect(
        experimentStatusCommand("doc-qa", { runId: "sdk_run" }),
      ).rejects.toMatchObject({ code: 1 });
    });
  });
});
