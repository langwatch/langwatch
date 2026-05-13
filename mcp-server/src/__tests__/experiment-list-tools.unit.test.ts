import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    makeRequest: vi.fn(),
  };
});

import { makeRequest } from "../langwatch-api.js";
import { handleExperimentList } from "../tools/list-experiments.js";
import { handleExperimentListRuns } from "../tools/list-experiment-runs.js";

const mockMakeRequest = vi.mocked(makeRequest);

describe("handleExperimentList()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given experiments exist", () => {
    describe("when invoked with default limit", () => {
      /** @scenario "Lists experiments as markdown" */
      it("renders a markdown table with each slug", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          experiments: [
            {
              id: "exp_1",
              slug: "checkout-flow",
              name: "Checkout Flow",
              type: "EVALUATIONS_V3",
              workflowId: null,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-02T00:00:00Z",
              runsCount: 3,
              lastRunAt: "2026-01-02T00:00:00Z",
            },
          ],
          pagination: {
            page: 1,
            pageSize: 25,
            totalHits: 1,
            hasMore: false,
          },
        });

        const out = await handleExperimentList({});
        expect(out).toContain("# Experiments");
        expect(out).toContain("`checkout-flow`");
        expect(out).toContain("Checkout Flow");
      });
    });

    describe("when invoked with limit above the cap", () => {
      /** @scenario "Limit is bounded to protect agent context" */
      it("clamps the effective pageSize to 100", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          experiments: [],
          pagination: { page: 1, pageSize: 100, totalHits: 0, hasMore: false },
        });

        await handleExperimentList({ limit: 5000 });
        const path = mockMakeRequest.mock.calls[0]![1] as string;
        expect(path).toContain("pageSize=100");
      });
    });
  });

  describe("given no experiments exist", () => {
    describe("when invoked", () => {
      it("returns an empty-state message", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          experiments: [],
          pagination: { page: 1, pageSize: 25, totalHits: 0, hasMore: false },
        });
        const out = await handleExperimentList({});
        expect(out).toContain("No experiments");
      });
    });
  });
});

describe("handleExperimentListRuns()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a known experiment with runs", () => {
    describe("when invoked", () => {
      /** @scenario "Lists runs for a known experiment" */
      it("renders a markdown table with each runId", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          experimentId: "exp_1",
          experimentSlug: "checkout-flow",
          runs: [
            {
              experimentId: "exp_1",
              runId: "run_visible",
              workflowVersion: null,
              timestamps: { createdAt: 1000, updatedAt: 2000, finishedAt: 2000 },
              summary: { evaluations: {} },
            },
          ],
          pagination: {
            page: 1,
            pageSize: 25,
            totalHits: 1,
            hasMore: false,
          },
        });

        const out = await handleExperimentListRuns({
          experimentSlug: "checkout-flow",
        });
        expect(out).toContain("# Evaluation Runs: checkout-flow");
        expect(out).toContain("`run_visible`");
      });
    });
  });

  describe("given the experiment slug is unknown", () => {
    describe("when the API throws 404", () => {
      /** @scenario "Unknown experiment slug returns a graceful not-found message" */
      it("returns a graceful not-found message suggesting platform_experiment_list", async () => {
        mockMakeRequest.mockRejectedValueOnce(
          new Error("LangWatch API error 404: experiment not found"),
        );

        const out = await handleExperimentListRuns({
          experimentSlug: "does-not-exist",
        });
        expect(out).toContain("not found");
        expect(out).toContain("platform_experiment_list");
      });
    });
  });

  describe("given the experiment exists but has no runs", () => {
    describe("when invoked", () => {
      it("returns an empty-state message that points at platform_run_experiment", async () => {
        mockMakeRequest.mockResolvedValueOnce({
          experimentId: "exp_1",
          experimentSlug: "support-bot",
          runs: [],
          pagination: { page: 1, pageSize: 25, totalHits: 0, hasMore: false },
        });

        const out = await handleExperimentListRuns({
          experimentSlug: "support-bot",
        });
        expect(out).toContain("no runs yet");
        expect(out).toContain("platform_run_experiment");
      });
    });
  });
});
