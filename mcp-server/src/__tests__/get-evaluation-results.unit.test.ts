import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    makeRequest: vi.fn(),
  };
});

import { makeRequest } from "../langwatch-api.js";
import { handleEvaluationResults } from "../tools/get-evaluation-results.js";

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
  timestamps: { createdAt: 0, updatedAt: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleEvaluationResults()", () => {
  describe("given a completed run", () => {
    describe("when called without filters", () => {
      it("hits the v3 results endpoint with the run id", async () => {
        mockMakeRequest.mockResolvedValueOnce(sample);
        await handleEvaluationResults({ runId: "run_1" });
        expect(mockMakeRequest).toHaveBeenCalledWith(
          "GET",
          "/api/evaluations/v3/runs/run_1/results",
        );
      });

      it("renders evaluator averages and per-row sections in markdown", async () => {
        mockMakeRequest.mockResolvedValueOnce(sample);
        const out = await handleEvaluationResults({ runId: "run_1" });
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
        const out = await handleEvaluationResults({
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
        const out = await handleEvaluationResults({
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
        const out = await handleEvaluationResults({ runId: "run_1" });
        expect(out).toContain("Output truncated to 50 rows of 80");
      });
    });
  });

  describe("given the run is missing", () => {
    describe("when the API throws a 404-shaped error", () => {
      it("returns a graceful 'not found' markdown", async () => {
        mockMakeRequest.mockRejectedValueOnce(new Error("404 Not Found"));
        const out = await handleEvaluationResults({ runId: "missing" });
        expect(out).toContain("not found");
        expect(out).toContain("platform_evaluation_status");
      });
    });
  });
});
