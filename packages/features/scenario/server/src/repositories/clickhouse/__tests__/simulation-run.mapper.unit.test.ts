/**
 * @see specs/scenarios/secret-run-parameters.feature
 */
import { describe, expect, it } from "vitest";
import {
  mapClickHouseRowToScenarioRunData,
  type ClickHouseSimulationRunRow,
} from "../simulation-run.mapper";

function row(overrides: Partial<ClickHouseSimulationRunRow> = {}): ClickHouseSimulationRunRow {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "Refund flow",
    Description: null,
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    StartedAt: "1000",
    CreatedAt: "1000",
    UpdatedAt: "2000",
    FinishedAt: "2000",
    ArchivedAt: null,
    ...overrides,
  };
}

describe("mapClickHouseRowToScenarioRunData", () => {
  describe("given a stored run that used a secret parameter", () => {
    /** @scenario "The runs API never returns a secret value" */
    it("serves the run back without a value or an encrypted form", () => {
      const data = mapClickHouseRowToScenarioRunData(
        row({
          Metadata: JSON.stringify({
            parameters: { region: "eu-central" },
            secretParameterNames: ["api_token"],
            secretParameters: { api_token: "enc:tok-live-1" },
          }),
        }),
      );

      const served = JSON.stringify(data);
      expect(served).not.toContain("tok-live-1");
      expect(served).not.toContain("secretParameters");
      expect(data.metadata).toMatchObject({ secretParameterNames: ["api_token"] });
    });
  });
});
