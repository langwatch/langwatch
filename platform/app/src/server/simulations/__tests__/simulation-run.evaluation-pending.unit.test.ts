import { describe, expect, it } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { EVALUATION_PENDING_GRACE_MS } from "~/server/scenarios/scenario-run-evaluators";
import {
  type ClickHouseSimulationRunRow,
  mapClickHouseRowToScenarioRunData,
} from "../simulation-run.mappers";

const FINISHED_AT = 2_200;
const NOW = FINISHED_AT + 1_000;

function makeRow(
  overrides: Partial<ClickHouseSimulationRunRow> = {},
): ClickHouseSimulationRunRow {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "Chargebacks by quarter",
    Description: null,
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "Every criterion was met.",
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
    FinishedAt: String(FINISHED_AT),
    ArchivedAt: null,
    ...overrides,
  };
}

describe("mapping a run that awaits its evaluators", () => {
  describe("when the row awaits evaluation and finished a moment ago", () => {
    /** @scenario "A pending run reads as PENDING_EVALUATION" */
    it("reads as PENDING_EVALUATION while still reporting the judge's verdict", () => {
      const run = mapClickHouseRowToScenarioRunData(
        makeRow({ EvaluationsPending: 1 }),
        { now: NOW },
      );

      expect(run.status).toBe(ScenarioRunStatus.PENDING_EVALUATION);
      expect(run.results?.verdict).toBe(Verdict.SUCCESS);
    });
  });

  describe("when the row awaits evaluation and finished longer ago than the grace period", () => {
    /** @scenario "The pending status expires so a lost job cannot hold a run open" */
    it("reads with the status the judge decided", () => {
      const run = mapClickHouseRowToScenarioRunData(
        makeRow({ EvaluationsPending: 1 }),
        { now: FINISHED_AT + EVALUATION_PENDING_GRACE_MS + 1 },
      );

      expect(run.status).toBe(ScenarioRunStatus.SUCCESS);
    });
  });

  describe("when the row awaits nothing", () => {
    /** @scenario "A run that never awaited evaluation reads with its own status" */
    it("reads with the status the judge decided", () => {
      const stored = mapClickHouseRowToScenarioRunData(
        makeRow({ EvaluationsPending: 0 }),
        { now: NOW },
      );
      const predatingTheColumn = mapClickHouseRowToScenarioRunData(makeRow(), {
        now: NOW,
      });

      expect(stored.status).toBe(ScenarioRunStatus.SUCCESS);
      expect(predatingTheColumn.status).toBe(ScenarioRunStatus.SUCCESS);
    });
  });

  describe("when the run has not finished", () => {
    it("still reads as IN_PROGRESS", () => {
      const run = mapClickHouseRowToScenarioRunData(
        makeRow({ EvaluationsPending: 1, FinishedAt: null }),
        { now: NOW },
      );

      expect(run.status).toBe(ScenarioRunStatus.IN_PROGRESS);
    });
  });
});
