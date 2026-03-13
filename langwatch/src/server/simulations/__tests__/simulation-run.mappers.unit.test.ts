import { describe, it, expect } from "vitest";
import {
  mapClickHouseRowToScenarioRunData,
  type ClickHouseSimulationRunRow,
} from "../simulation-run.mappers";
import { ScenarioRunStatus, Verdict } from "../../scenarios/scenario-event.enums";
import { STALL_THRESHOLD_MS } from "../../scenarios/stall-detection";

function makeRow(overrides: Partial<ClickHouseSimulationRunRow> = {}): ClickHouseSimulationRunRow {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "Test run",
    Description: "A test",
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: ["criterion-a"],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    CreatedAt: "1000",
    UpdatedAt: "2500",
    FinishedAt: "2500",
    ArchivedAt: null,
    ...overrides,
  };
}

describe("mapClickHouseRowToScenarioRunData()", () => {
  describe("when row represents a completed successful run", () => {
    it("maps all fields correctly", () => {
      const row = makeRow();
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.scenarioRunId).toBe("run-1");
      expect(result.scenarioId).toBe("scenario-1");
      expect(result.batchRunId).toBe("batch-1");
      expect(result.name).toBe("Test run");
      expect(result.description).toBe("A test");
      expect(result.status).toBe(ScenarioRunStatus.SUCCESS);
      expect(result.results).toEqual({
        verdict: Verdict.SUCCESS,
        reasoning: "All good",
        metCriteria: ["criterion-a"],
        unmetCriteria: [],
        error: undefined,
      });
      expect(result.timestamp).toBe(2500);
      expect(result.durationInMs).toBe(1500);
    });
  });

  describe("when row represents a failed run with verdict 'failure'", () => {
    it("maps status to FAILED", () => {
      const row = makeRow({ Status: "FAILURE", Verdict: "failure", FinishedAt: "2500" });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.status).toBe(ScenarioRunStatus.FAILED);
      expect(result.results?.verdict).toBe(Verdict.FAILURE);
    });
  });

  describe("when row has no verdict", () => {
    it("returns null results", () => {
      const row = makeRow({ Verdict: null, Reasoning: null, Status: "ERROR", FinishedAt: "2500" });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.results).toBeNull();
      expect(result.status).toBe(ScenarioRunStatus.ERROR);
    });
  });

  describe("when row has no DurationMs", () => {
    it("computes duration from FinishedAt - CreatedAt", () => {
      const row = makeRow({ DurationMs: null, CreatedAt: "1000", FinishedAt: "3000" });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.durationInMs).toBe(2000);
    });
  });

  describe("when row has no FinishedAt and no DurationMs", () => {
    it("computes duration from UpdatedAt - CreatedAt", () => {
      const row = makeRow({
        DurationMs: null,
        FinishedAt: null,
        Status: "IN_PROGRESS",
        Verdict: null,
        CreatedAt: "1000",
        UpdatedAt: "5000",
      });
      const now = 6000; // Not stalled yet
      const result = mapClickHouseRowToScenarioRunData(row, now);

      expect(result.durationInMs).toBe(4000); // UpdatedAt - CreatedAt
    });
  });

  describe("when row represents an in-progress run that has stalled", () => {
    it("resolves status to STALLED", () => {
      const oldTimestamp = Date.now() - STALL_THRESHOLD_MS - 1;
      const row = makeRow({
        Status: "IN_PROGRESS",
        FinishedAt: null,
        Verdict: null,
        UpdatedAt: String(oldTimestamp),
      });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.status).toBe(ScenarioRunStatus.STALLED);
    });
  });

  describe("when row represents an in-progress run that has NOT stalled", () => {
    it("resolves status to IN_PROGRESS", () => {
      const recentTimestamp = Date.now() - 1000;
      const row = makeRow({
        Status: "IN_PROGRESS",
        FinishedAt: null,
        Verdict: null,
        UpdatedAt: String(recentTimestamp),
      });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.status).toBe(ScenarioRunStatus.IN_PROGRESS);
    });
  });

  describe("when messages are present in parallel arrays", () => {
    it("reconstructs messages array from parallel columns", () => {
      const row = makeRow({
        "Messages.Id": ["msg-1"],
        "Messages.Role": ["user"],
        "Messages.Content": ["hello"],
        "Messages.TraceId": [""],
        "Messages.Rest": [""],
      });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.messages).toEqual([
        { id: "msg-1", role: "user", content: "hello", trace_id: undefined },
      ]);
    });
  });

  describe("when messages arrays are empty", () => {
    it("returns empty messages array", () => {
      const row = makeRow({
        "Messages.Id": [],
        "Messages.Role": [],
        "Messages.Content": [],
        "Messages.TraceId": [],
        "Messages.Rest": [],
      });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.messages).toEqual([]);
    });
  });

  describe("when row has a Metadata JSON string", () => {
    it("parses metadata back to an object", () => {
      const metadataObj = {
        name: "my-scenario",
        langwatch: { targetReferenceId: "ref-1", simulationSuiteId: "suite-1" },
      };
      const row = makeRow({ Metadata: JSON.stringify(metadataObj) });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.metadata).toEqual(metadataObj);
    });
  });

  describe("when row has no Metadata", () => {
    it("returns null metadata", () => {
      const row = makeRow({ Metadata: null });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.metadata).toBeNull();
    });
  });

  describe("when Metadata contains invalid JSON", () => {
    it("returns null metadata", () => {
      const row = makeRow({ Metadata: "{not-valid-json" });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.metadata).toBeNull();
    });
  });

  describe("when metadata round-trips through JSON serialization", () => {
    it("preserves the original structure", () => {
      const original = {
        name: "test",
        description: "desc",
        langwatch: { targetReferenceId: "ref-42", simulationSuiteId: "suite-7" },
        custom: { nested: { key: "value" } },
      };
      const serialized = JSON.stringify(original);
      const row = makeRow({ Metadata: serialized });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.metadata).toEqual(original);
    });
  });

  describe("when verdict is inconclusive", () => {
    it("maps verdict correctly", () => {
      const row = makeRow({ Verdict: "inconclusive", FinishedAt: "2500" });
      const result = mapClickHouseRowToScenarioRunData(row, Date.now());

      expect(result.results?.verdict).toBe(Verdict.INCONCLUSIVE);
    });
  });
});
