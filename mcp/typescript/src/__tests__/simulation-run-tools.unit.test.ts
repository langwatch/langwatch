/**
 * The digest of a simulation run carries the result of every evaluator that
 * ran after the conversation, beside the judge's verdict.
 *
 * @see specs/mcp-server/test-suite-tools.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api-simulation-runs.js", () => ({
  getSimulationRun: vi.fn(),
  listSimulationRuns: vi.fn(),
}));

import {
  getSimulationRun,
  type SimulationRunSummary,
} from "../langwatch-api-simulation-runs.js";
import { handleGetSimulationRun } from "../tools/get-simulation-run.js";

const mockGetSimulationRun = vi.mocked(getSimulationRun);

const run: SimulationRunSummary = {
  scenarioRunId: "run_1",
  scenarioId: "scen_1",
  batchRunId: "batch_1",
  name: "Chargebacks by quarter",
  status: "FAILED",
  durationInMs: 4200,
  results: {
    verdict: "failed",
    reasoning: "SQL Query Equivalence failed",
    metCriteria: ["Answers with one row per quarter"],
    unmetCriteria: [],
    error: null,
    evaluations: [
      {
        evaluatorId: "evaluator_sql",
        name: "SQL Query Equivalence",
        status: "failed",
        required: true,
        passed: false,
        details: "The query groups by month, not by quarter",
      },
      {
        evaluatorId: "evaluator_judge",
        name: "Answer quality",
        status: "scored",
        required: false,
        score: 0.8,
      },
      {
        evaluatorId: "evaluator_ctx",
        name: "Context recall",
        status: "skipped",
        required: false,
        details: "no table_schema on this scenario",
      },
    ],
  },
  messages: [],
  timestamp: 1_700_000_000_000,
  updatedAt: 1_700_000_004_200,
};

describe("handleGetSimulationRun()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSimulationRun.mockResolvedValue(run);
  });

  describe("when the run carries evaluator results", () => {
    /** @scenario "Agent reads a simulation run with evaluator results" */
    it("lists each evaluator with its status, score, gate and reason", async () => {
      const result = await handleGetSimulationRun({ scenarioRunId: "run_1" });

      expect(result).toContain("## Evaluators");
      expect(result).toContain("**SQL Query Equivalence**: failed, required");
      expect(result).toContain("The query groups by month, not by quarter");
      expect(result).toContain("**Answer quality**: scored, score 0.8");
      expect(result).toContain("**Context recall**: skipped");
      expect(result).toContain("no table_schema on this scenario");
    });

    /** @scenario "Agent reads a simulation run with evaluator results" */
    it("serves them under results.evaluations in the json format", async () => {
      const result = await handleGetSimulationRun({
        scenarioRunId: "run_1",
        format: "json",
      });

      const parsed = JSON.parse(result) as SimulationRunSummary;
      expect(parsed.results?.evaluations).toHaveLength(3);
    });
  });

  describe("when the run is still waiting on its evaluators", () => {
    /** @scenario "A pending run reads as PENDING_EVALUATION" */
    it("warns that the verdict is not final yet", async () => {
      mockGetSimulationRun.mockResolvedValue({
        ...run,
        status: "PENDING_EVALUATION",
      });

      const result = await handleGetSimulationRun({ scenarioRunId: "run_1" });

      expect(result).toContain("**Status**: PENDING_EVALUATION");
      expect(result).toContain("have not been recorded yet");
    });

    it("says nothing extra once they are recorded", async () => {
      const result = await handleGetSimulationRun({ scenarioRunId: "run_1" });

      expect(result).not.toContain("have not been recorded yet");
    });
  });
});
