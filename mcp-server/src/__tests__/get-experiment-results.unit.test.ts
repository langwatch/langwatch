import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    makeRequest: vi.fn(),
  };
});

import { LangWatchApiError, makeRequest } from "../langwatch-api.js";
import { handleExperimentResults } from "../tools/get-experiment-results.js";

const mockMakeRequest = vi.mocked(makeRequest);

const sample = {
  experimentId: "exp_1",
  runId: "run_1",
  projectId: "proj_1",
  progress: 3,
  total: 3,
  dataset: [
    { index: 0, entry: { input: "hello world" } },
    { index: 1, entry: { input: "broken" }, error: "boom" },
    { index: 2, entry: { input: "low" } },
  ],
  evaluations: [
    { evaluator: "quality", index: 0, status: "processed", score: 0.9, passed: true },
    { evaluator: "quality", index: 2, status: "processed", score: 0.2, passed: false, details: "off-topic" },
    { evaluator: "safety", index: 0, status: "processed", score: 1.0, passed: true },
  ],
  timestamps: { createdAt: 0, updatedAt: 0, finishedAt: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleExperimentResults()", () => {
  describe("given a completed run", () => {
    describe("when called without filters", () => {
      it("hits the v3 results endpoint with the run id", async () => {
        mockMakeRequest.mockResolvedValueOnce(sample);
        await handleExperimentResults({ runId: "run_1" });
        expect(mockMakeRequest).toHaveBeenCalledWith(
          "GET",
          "/api/experiments/runs/run_1/results",
        );
      });

      it("renders evaluator averages and per-row sections in markdown", async () => {
        mockMakeRequest.mockResolvedValueOnce(sample);
        const out = await handleExperimentResults({ runId: "run_1" });
        expect(out).toContain("# Evaluation Results: run_1");
        expect(out).toContain("## Evaluator Summary");
        expect(out).toContain("quality");
        expect(out).toContain("safety");
        expect(out).toContain("Row #0");
        expect(out).toContain("Row #1");
        expect(out).toContain("Row #2");
      });
    });

    describe("when filter is 'failed'", () => {
      it("includes only failed/errored rows", async () => {
        mockMakeRequest.mockResolvedValueOnce(sample);
        const out = await handleExperimentResults({
          runId: "run_1",
          filter: "failed",
        });
        expect(out).toContain("Row #1");
        expect(out).toContain("Row #2");
        expect(out).not.toContain("Row #0");
      });
    });

    describe("when an evaluator name is supplied", () => {
      it("limits the report to that evaluator", async () => {
        mockMakeRequest.mockResolvedValueOnce(sample);
        const out = await handleExperimentResults({
          runId: "run_1",
          evaluator: "quality",
        });
        expect(out).toContain("quality");
        // The per-row sections should not list the safety evaluator bullet
        expect(out).not.toMatch(/\*\*safety\*\*/);
      });
    });

    describe("when there are more rows than the cap", () => {
      it("truncates and notes the cap", async () => {
        const big = {
          ...sample,
          dataset: Array.from({ length: 80 }, (_, i) => ({
            index: i,
            entry: { input: `row ${i}` },
          })),
          evaluations: [],
        };
        mockMakeRequest.mockResolvedValueOnce(big);
        const out = await handleExperimentResults({ runId: "run_1" });
        expect(out).toContain("Output truncated to 50 rows of 80");
      });
    });

    describe("when a caller asks for more than the row cap", () => {
      it("still caps output at 50 rows", async () => {
        const big = {
          ...sample,
          dataset: Array.from({ length: 80 }, (_, i) => ({
            index: i,
            entry: { input: `row ${i}` },
          })),
          evaluations: [],
        };
        mockMakeRequest.mockResolvedValueOnce(big);
        const out = await handleExperimentResults({
          runId: "run_1",
          limit: 5000,
        });
        expect(out).toContain("Output truncated to 50 rows of 80");
      });
    });

    describe("when only some rows have evaluations", () => {
      it("explains rows with no evaluation coverage", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          ...sample,
          dataset: [
            { index: 0, entry: { input: "covered" } },
            { index: 1, entry: { input: "uncovered" } },
          ],
          evaluations: [
            {
              evaluator: "quality",
              index: 0,
              status: "processed",
              score: 0.9,
              passed: true,
            },
          ],
        });

        const out = await handleExperimentResults({ runId: "run_1" });

        expect(out).toContain("uncovered");
        expect(out).toContain("No evaluations recorded for this row");
      });
    });

    describe("when multiple targets share the same dataset index", () => {
      it("keeps evaluator rows target-scoped", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          ...sample,
          dataset: [
            { index: 0, targetId: "a", entry: { input: "target a" } },
            { index: 0, targetId: "b", entry: { input: "target b" } },
          ],
          evaluations: [
            {
              evaluator: "quality",
              index: 0,
              targetId: "a",
              status: "processed",
              score: 0.9,
              passed: true,
            },
            {
              evaluator: "quality",
              index: 0,
              targetId: "b",
              status: "processed",
              score: 0.1,
              passed: false,
              details: "target-b-only",
            },
          ],
        });

        const out = await handleExperimentResults({
          runId: "run_1",
          filter: "failed",
        });

        expect(out).toContain("target b");
        expect(out).toContain("target-b-only");
        expect(out).not.toContain("target a");
      });
    });
  });

  describe("given the run is missing", () => {
    describe("when the API throws a 404-shaped error", () => {
      it("returns a graceful 'not found' markdown", async () => {
        mockMakeRequest.mockRejectedValueOnce(
          new LangWatchApiError("missing", 404, "Run not found"),
        );
        const out = await handleExperimentResults({ runId: "missing" });
        expect(out).toContain("not found");
        expect(out).toContain("experimentSlug");
      });
    });
  });

  describe("given the run is still in progress", () => {
    describe("when results are requested", () => {
      it("serves the partial rows logged so far with an in-progress note", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          ...sample,
          progress: 2,
          total: 3,
          timestamps: {
            createdAt: Date.now(),
            updatedAt: Date.now(),
            finishedAt: null,
            stoppedAt: null,
          },
        });

        const out = await handleExperimentResults({ runId: "unfinished" });

        expect(out).toContain("**Status**: running");
        expect(out).toContain("still in progress");
        expect(out).toContain("Row #0");
        expect(out).toContain("Progress**: 2/3");
      });
    });
  });

  describe("given the run was interrupted before finishing", () => {
    describe("when results are requested", () => {
      it("serves the partial rows with an interrupted note", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          ...sample,
          timestamps: {
            createdAt: Date.now() - 60 * 60 * 1000,
            updatedAt: Date.now() - 30 * 60 * 1000,
            finishedAt: null,
            stoppedAt: null,
          },
        });

        const out = await handleExperimentResults({ runId: "interrupted" });

        expect(out).toContain("**Status**: interrupted");
        expect(out).toContain("interrupted");
        expect(out).toContain("Row #0");
      });
    });
  });

  describe("given no run state but rows exist (SDK / >24h run)", () => {
    describe("when results are requested with a stopped run", () => {
      it("renders results for a stopped run", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          ...sample,
          timestamps: {
            createdAt: 0,
            updatedAt: 10,
            finishedAt: null,
            stoppedAt: 20,
          },
        });

        const out = await handleExperimentResults({ runId: "stopped" });

        expect(out).toContain("**Status**: stopped");
        expect(out).toContain("Row #0");
      });
    });
  });
});
