import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    makeRequest: vi.fn(),
  };
});

import { LangWatchApiError, makeRequest } from "../langwatch-api.js";
import { handleExperimentStatus } from "../tools/run-experiment.js";
import {
  deriveRunStatus,
  isTerminalStatus,
} from "../tools/experiment-run-status.js";

const mockMakeRequest = vi.mocked(makeRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deriveRunStatus()", () => {
  describe("when stoppedAt is set", () => {
    it("is stopped", () => {
      expect(deriveRunStatus({ stoppedAt: 5 })).toBe("stopped");
    });
  });

  describe("when finishedAt is set", () => {
    it("is completed", () => {
      expect(deriveRunStatus({ finishedAt: 5 })).toBe("completed");
    });
  });

  describe("when no terminal marker and updates are recent", () => {
    it("is running", () => {
      const now = 1_000_000;
      expect(deriveRunStatus({ updatedAt: now - 1000 }, now)).toBe("running");
    });
  });

  describe("when no terminal marker and no recent updates", () => {
    it("is interrupted", () => {
      const now = 1_000_000;
      expect(deriveRunStatus({ updatedAt: now - 6 * 60 * 1000 }, now)).toBe(
        "interrupted",
      );
    });
  });

  describe("terminal classification", () => {
    it("treats completed and stopped as terminal", () => {
      expect(isTerminalStatus("completed")).toBe(true);
      expect(isTerminalStatus("stopped")).toBe(true);
      expect(isTerminalStatus("running")).toBe(false);
      expect(isTerminalStatus("interrupted")).toBe(false);
    });
  });
});

describe("handleExperimentStatus()", () => {
  describe("given the run state exists in Redis", () => {
    it("reports the status straight from the status endpoint", async () => {
      mockMakeRequest.mockResolvedValueOnce({
        runId: "run_1",
        status: "completed",
        progress: 3,
        total: 3,
      });

      const out = await handleExperimentStatus({ runId: "run_1" });

      expect(mockMakeRequest).toHaveBeenCalledWith(
        "GET",
        "/api/experiments/runs/run_1",
      );
      expect(out).toContain("**Status**: completed");
      expect(out).toContain("3/3 cells");
    });
  });

  describe("given an SDK-logged run with no Redis state", () => {
    it("falls back to deriving status from the results endpoint", async () => {
      mockMakeRequest
        .mockRejectedValueOnce(
          new LangWatchApiError("missing", 404, "Run not found"),
        )
        .mockResolvedValueOnce({
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

      const out = await handleExperimentStatus({
        runId: "sdk_run",
        experimentSlug: "doc-qa",
      });

      expect(mockMakeRequest).toHaveBeenNthCalledWith(
        1,
        "GET",
        "/api/experiments/runs/sdk_run",
      );
      expect(mockMakeRequest).toHaveBeenNthCalledWith(
        2,
        "GET",
        "/api/experiments/runs/sdk_run/results?experimentSlug=doc-qa",
      );
      expect(out).toContain("**Status**: completed");
      expect(out).toContain("5/5 cells");
      expect(out).toContain("platform_experiment_results");
    });

    it("reports interrupted for a stale unfinished SDK run", async () => {
      mockMakeRequest
        .mockRejectedValueOnce(
          new LangWatchApiError("missing", 404, "Run not found"),
        )
        .mockResolvedValueOnce({
          progress: 2,
          total: 5,
          dataset: [1, 2],
          timestamps: {
            createdAt: Date.now() - 60 * 60 * 1000,
            updatedAt: Date.now() - 30 * 60 * 1000,
            finishedAt: null,
            stoppedAt: null,
          },
        });

      const out = await handleExperimentStatus({
        runId: "sdk_run",
        experimentSlug: "doc-qa",
      });

      expect(out).toContain("**Status**: interrupted");
      expect(out).toContain("2/5 cells");
    });
  });

  describe("given the run cannot be found anywhere", () => {
    it("returns actionable guidance instead of a raw 404", async () => {
      mockMakeRequest
        .mockRejectedValueOnce(
          new LangWatchApiError("missing", 404, "Run not found"),
        )
        .mockRejectedValueOnce(
          new LangWatchApiError("missing", 404, "Run not found"),
        );

      const out = await handleExperimentStatus({
        runId: "nope",
        experimentSlug: "doc-qa",
      });

      expect(out).toContain("not found");
      expect(out).toContain("experimentSlug");
      expect(out).toContain("platform_experiment_results");
    });

    it("rethrows non-404 errors from the status endpoint", async () => {
      mockMakeRequest.mockRejectedValueOnce(
        new LangWatchApiError("boom", 500, "Internal error"),
      );

      await expect(
        handleExperimentStatus({ runId: "nope" }),
      ).rejects.toThrow();
    });
  });
});
