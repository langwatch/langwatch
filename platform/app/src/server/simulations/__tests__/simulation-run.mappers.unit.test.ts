import { describe, expect, it } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioEvaluationResult } from "~/server/scenarios/schemas/event-schemas";
import {
  columnsToEvaluations,
  evaluationsToColumns,
} from "../simulation-evaluations.columns";
import {
  type ClickHouseSimulationRunRow,
  mapClickHouseRowToScenarioRunData,
} from "../simulation-run.mappers";

const FULL: ScenarioEvaluationResult = {
  evaluatorId: "ragas/sql_query_equivalence",
  name: "SQL Query Equivalence",
  status: "failed",
  required: true,
  passed: false,
  score: 0.25,
  label: "different",
  details: "The generated query filters on the wrong column.",
  cost: { currency: "USD", amount: 0.0012 },
  inputs: { output: "SELECT 1", expected_output: "SELECT 2" },
};

const MINIMAL: ScenarioEvaluationResult = {
  evaluatorId: "eval_quality",
  name: "Answer quality",
  status: "skipped",
  required: false,
};

function makeRow(
  overrides: Partial<ClickHouseSimulationRunRow> = {},
): ClickHouseSimulationRunRow {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "FAILURE",
    Name: "Chargebacks by quarter",
    Description: null,
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "failure",
    Reasoning: "The SQL check failed.",
    MetCriteria: ["Answers politely"],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1200",
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    StartedAt: "1000",
    CreatedAt: "1000",
    UpdatedAt: "3000",
    FinishedAt: "2200",
    ArchivedAt: null,
    ...overrides,
  };
}

describe("evaluation columns", () => {
  describe("when evaluations are written as columns and read back", () => {
    it("reads back the same evaluations", () => {
      const columns = evaluationsToColumns([FULL, MINIMAL]);

      expect(columns["Evaluations.Required"]).toEqual([1, 0]);
      expect(columns["Evaluations.Passed"]).toEqual([0, null]);
      expect(columns["Evaluations.InputsJson"]).toEqual([
        JSON.stringify(FULL.inputs),
        "",
      ]);
      expect(columnsToEvaluations(columns)).toEqual([FULL, MINIMAL]);
    });
  });

  describe("when a row predates the evaluation columns", () => {
    it("reads as no evaluations", () => {
      expect(columnsToEvaluations({})).toEqual([]);
    });
  });

  describe("when a trimmed read left the prose columns out", () => {
    it("reads every entry without details or inputs", () => {
      const columns = evaluationsToColumns([FULL]);
      const trimmed = {
        ...columns,
        "Evaluations.Details": [],
        "Evaluations.InputsJson": [],
      };

      const { details: _details, inputs: _inputs, ...withoutProse } = FULL;
      expect(columnsToEvaluations(trimmed)).toEqual([withoutProse]);
    });
  });
});

describe("mapClickHouseRowToScenarioRunData", () => {
  describe("when the row carries evaluation columns", () => {
    /** @scenario "A stored run maps its evaluations onto its results" */
    it("puts the typed evaluations on the results", () => {
      const row = makeRow(evaluationsToColumns([FULL, MINIMAL]));

      const run = mapClickHouseRowToScenarioRunData(row);

      expect(run.status).toBe(ScenarioRunStatus.FAILED);
      expect(run.results).toEqual({
        verdict: Verdict.FAILURE,
        reasoning: "The SQL check failed.",
        metCriteria: ["Answers politely"],
        unmetCriteria: [],
        error: undefined,
        evaluations: [FULL, MINIMAL],
      });
    });
  });

  describe("when the row carries no evaluation columns", () => {
    it("maps to results without evaluations", () => {
      const run = mapClickHouseRowToScenarioRunData(makeRow());

      expect(run.results).not.toHaveProperty("evaluations");
      expect(run.results?.verdict).toBe(Verdict.FAILURE);
    });
  });
});
