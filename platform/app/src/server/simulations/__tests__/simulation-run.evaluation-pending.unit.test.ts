import { describe, expect, it } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import {
  type ClickHouseSimulationRunRow,
  mapClickHouseRowToScenarioRunData,
} from "../simulation-run.mappers";

const FINISHED_AT = 2_200;

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
  describe("when the row is stored PENDING_EVALUATION", () => {
    /** @scenario "A pending run reads as PENDING_EVALUATION" */
    it("reads as PENDING_EVALUATION while still reporting the judge's verdict", () => {
      const run = mapClickHouseRowToScenarioRunData(
        makeRow({ Status: "PENDING_EVALUATION" }),
      );

      expect(run.status).toBe(ScenarioRunStatus.PENDING_EVALUATION);
      expect(run.results?.verdict).toBe(Verdict.SUCCESS);
    });
  });

  describe("when the row is stored with a terminal status", () => {
    /** @scenario "A settled run reads with its stored status" */
    it("reads with the status the gate wrote", () => {
      const passed = mapClickHouseRowToScenarioRunData(
        makeRow({ Status: "SUCCESS" }),
      );
      const failed = mapClickHouseRowToScenarioRunData(
        makeRow({ Status: "FAILURE", Verdict: "failure" }),
      );

      expect(passed.status).toBe(ScenarioRunStatus.SUCCESS);
      expect(failed.status).toBe(ScenarioRunStatus.FAILED);
    });
  });

  describe("when the run has not finished", () => {
    it("still reads as IN_PROGRESS", () => {
      const run = mapClickHouseRowToScenarioRunData(
        makeRow({ Status: "PENDING_EVALUATION", FinishedAt: null }),
      );

      expect(run.status).toBe(ScenarioRunStatus.IN_PROGRESS);
    });
  });
});
