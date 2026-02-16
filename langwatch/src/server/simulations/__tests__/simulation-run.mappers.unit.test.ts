import { describe, it, expect } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/app/api/scenario-events/[[...route]]/enums";
import type { ClickHouseSimulationRunRow } from "../simulation-run.mappers";
import { mapClickHouseRowToScenarioRunData } from "../simulation-run.mappers";

function makeRow(
  overrides: Partial<ClickHouseSimulationRunRow> = {},
): ClickHouseSimulationRunRow {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: ScenarioRunStatus.SUCCESS,
    Name: "Test Scenario",
    Description: "A test scenario",
    Messages: JSON.stringify([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]),
    Verdict: Verdict.SUCCESS,
    Reasoning: "All criteria met",
    MetCriteria: JSON.stringify(["criterion-1", "criterion-2"]),
    UnmetCriteria: JSON.stringify([]),
    Error: null,
    DurationMs: "1500",
    CreatedAt: "1700000000000",
    ...overrides,
  };
}

describe("mapClickHouseRowToScenarioRunData", () => {
  it("maps PascalCase columns to camelCase fields", () => {
    const row = makeRow();
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.scenarioRunId).toBe("run-1");
    expect(result.scenarioId).toBe("scenario-1");
    expect(result.batchRunId).toBe("batch-1");
    expect(result.name).toBe("Test Scenario");
    expect(result.description).toBe("A test scenario");
    expect(result.status).toBe(ScenarioRunStatus.SUCCESS);
    expect(result.timestamp).toBe(1700000000000);
    expect(result.durationInMs).toBe(1500);
  });

  it("parses Messages JSON string into array", () => {
    const row = makeRow();
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("builds results from Verdict/Reasoning/MetCriteria/UnmetCriteria", () => {
    const row = makeRow({
      Verdict: Verdict.FAILURE,
      Reasoning: "Criterion 2 was not met",
      MetCriteria: JSON.stringify(["criterion-1"]),
      UnmetCriteria: JSON.stringify(["criterion-2"]),
    });
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.results).toEqual({
      verdict: Verdict.FAILURE,
      reasoning: "Criterion 2 was not met",
      metCriteria: ["criterion-1"],
      unmetCriteria: ["criterion-2"],
    });
  });

  it("returns null results when Verdict is null", () => {
    const row = makeRow({
      Verdict: null,
      Reasoning: null,
      MetCriteria: "[]",
      UnmetCriteria: "[]",
    });
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.results).toBeNull();
  });

  it("includes error in results when present", () => {
    const row = makeRow({
      Verdict: Verdict.FAILURE,
      Error: "Something went wrong",
    });
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.results?.error).toBe("Something went wrong");
  });

  it("defaults durationInMs to 0 when DurationMs is null", () => {
    const row = makeRow({ DurationMs: null });
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.durationInMs).toBe(0);
  });

  it("defaults name and description to null when absent", () => {
    const row = makeRow({ Name: null, Description: null });
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.name).toBeNull();
    expect(result.description).toBeNull();
  });

  it("handles invalid Messages JSON gracefully", () => {
    const row = makeRow({ Messages: "not-valid-json" });
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.messages).toEqual([]);
  });

  it("handles non-array Messages JSON gracefully", () => {
    const row = makeRow({ Messages: '"just a string"' });
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.messages).toEqual([]);
  });

  it("maps Status string to ScenarioRunStatus enum", () => {
    for (const status of Object.values(ScenarioRunStatus)) {
      const row = makeRow({ Status: status });
      const result = mapClickHouseRowToScenarioRunData(row);
      expect(result.status).toBe(status);
    }
  });

  it("omits reasoning from results when Reasoning is null", () => {
    const row = makeRow({
      Verdict: Verdict.INCONCLUSIVE,
      Reasoning: null,
    });
    const result = mapClickHouseRowToScenarioRunData(row);

    expect(result.results?.reasoning).toBeUndefined();
  });
});
