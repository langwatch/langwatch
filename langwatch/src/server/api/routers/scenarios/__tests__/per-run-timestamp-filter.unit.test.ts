import { describe, it, expect } from "vitest";
import { filterRunsByTimestamp } from "../scenario-events.router";
import type { BatchRunDataResult } from "~/server/scenarios/scenario-event.types";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

function createRun(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "scenario-1",
    batchRunId: "batch-1",
    scenarioRunId: "run-1",
    name: null,
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: null,
    messages: [],
    timestamp: 1000,
    durationInMs: 500,
    ...overrides,
  };
}

describe("filterRunsByTimestamp()", () => {
  describe("when result has not changed", () => {
    it("returns the unchanged result as-is", () => {
      const result: BatchRunDataResult = { changed: false, lastUpdatedAt: 500 };
      const out = filterRunsByTimestamp(result, { "run-1": 100 });
      expect(out).toEqual({ changed: false, lastUpdatedAt: 500 });
    });
  });

  describe("when runTimestamps is not provided", () => {
    it("returns the original result unchanged (backward compatible)", () => {
      const runs = [createRun({ scenarioRunId: "run-1", timestamp: 1000 })];
      const result: BatchRunDataResult = { changed: true, lastUpdatedAt: 1000, runs };
      const out = filterRunsByTimestamp(result, undefined);
      expect(out).toEqual(result);
    });
  });

  describe("when a run has a newer timestamp than the client's", () => {
    it("includes the updated run", () => {
      const runs = [
        createRun({ scenarioRunId: "run-1", timestamp: 2000 }),
        createRun({ scenarioRunId: "run-2", timestamp: 1000 }),
      ];
      const result: BatchRunDataResult = { changed: true, lastUpdatedAt: 2000, runs };

      const out = filterRunsByTimestamp(result, { "run-1": 1000, "run-2": 1000 });

      expect(out.changed).toBe(true);
      if (out.changed) {
        expect(out.runs).toHaveLength(1);
        expect(out.runs[0]!.scenarioRunId).toBe("run-1");
      }
    });
  });

  describe("when a run is not in the client's map (new run)", () => {
    it("includes the new run", () => {
      const runs = [
        createRun({ scenarioRunId: "run-1", timestamp: 1000 }),
        createRun({ scenarioRunId: "run-2", timestamp: 1000 }),
      ];
      const result: BatchRunDataResult = { changed: true, lastUpdatedAt: 1000, runs };

      // Client only knows about run-1
      const out = filterRunsByTimestamp(result, { "run-1": 1000 });

      expect(out.changed).toBe(true);
      if (out.changed) {
        expect(out.runs).toHaveLength(1);
        expect(out.runs[0]!.scenarioRunId).toBe("run-2");
      }
    });
  });

  describe("when all runs match the client's timestamps", () => {
    it("returns changed: false", () => {
      const runs = [
        createRun({ scenarioRunId: "run-1", timestamp: 1000 }),
        createRun({ scenarioRunId: "run-2", timestamp: 2000 }),
      ];
      const result: BatchRunDataResult = { changed: true, lastUpdatedAt: 2000, runs };

      const out = filterRunsByTimestamp(result, { "run-1": 1000, "run-2": 2000 });

      expect(out.changed).toBe(false);
      expect(out.lastUpdatedAt).toBe(2000);
    });
  });
});
