/**
 * Unit tests for scenario-run merge and deduplication logic.
 *
 * Covers:
 * - Stored entries win when both sources share a scenarioRunId
 * - Non-overlapping entries from both sources are preserved
 * - Edge cases: no queued jobs, no stored data
 */

import { describe, it, expect } from "vitest";
import { ScenarioRunStatus } from "../../scenarios/scenario-event.enums";
import { mergeRunData } from "../scenario-run.utils";
import type { ScenarioRunData } from "../scenario-event.types";

function makeRunData(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "scen_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    name: "Angry refund request",
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: null,
    messages: [],
    timestamp: 1700000000000,
    durationInMs: 2300,
    ...overrides,
  };
}

describe("mergeRunData()", () => {
  describe("given stored and queued rows with no overlap", () => {
    const esRuns = [makeRunData({ scenarioRunId: "scenariorun_aaa" })];
    const queuedRuns = [
      makeRunData({
        scenarioRunId: "scenariorun_bbb",
        status: ScenarioRunStatus.QUEUED,
      }),
    ];

    it("returns both entries", () => {
      const result = mergeRunData({ esRuns, queuedRuns });
      expect(result).toHaveLength(2);
    });

    it("places stored rows first", () => {
      const result = mergeRunData({ esRuns, queuedRuns });
      expect(result[0]?.scenarioRunId).toBe("scenariorun_aaa");
      expect(result[1]?.scenarioRunId).toBe("scenariorun_bbb");
    });
  });

  describe("given overlapping entries (same scenarioRunId)", () => {
    const esRun = makeRunData({
      scenarioRunId: "scenariorun_same",
      status: ScenarioRunStatus.SUCCESS,
    });
    const queuedRun = makeRunData({
      scenarioRunId: "scenariorun_same",
      status: ScenarioRunStatus.QUEUED,
    });

    it("returns only the stored version", () => {
      const result = mergeRunData({ esRuns: [esRun], queuedRuns: [queuedRun] });
      expect(result).toHaveLength(1);
      expect(result[0]?.scenarioRunId).toBe("scenariorun_same");
      expect(result[0]?.status).toBe(ScenarioRunStatus.SUCCESS);
    });
  });

  describe("given no queued jobs", () => {
    const esRuns = [
      makeRunData({ scenarioRunId: "scenariorun_aaa" }),
      makeRunData({ scenarioRunId: "scenariorun_bbb" }),
    ];

    it("returns only stored data", () => {
      const result = mergeRunData({ esRuns, queuedRuns: [] });
      expect(result).toHaveLength(2);
      expect(result).toEqual(esRuns);
    });
  });

  describe("given no stored data", () => {
    const queuedRuns = [
      makeRunData({
        scenarioRunId: "scenariorun_aaa",
        status: ScenarioRunStatus.QUEUED,
      }),
      makeRunData({
        scenarioRunId: "scenariorun_bbb",
        status: ScenarioRunStatus.RUNNING,
      }),
    ];

    it("returns only queued job rows", () => {
      const result = mergeRunData({ esRuns: [], queuedRuns });
      expect(result).toHaveLength(2);
      expect(result[0]?.status).toBe(ScenarioRunStatus.QUEUED);
      expect(result[1]?.status).toBe(ScenarioRunStatus.RUNNING);
    });
  });

  describe("given mixed overlap and unique entries", () => {
    const esRuns = [
      makeRunData({ scenarioRunId: "scenariorun_aaa" }),
      makeRunData({ scenarioRunId: "scenariorun_ccc" }),
    ];
    const queuedRuns = [
      // Overlaps with esRuns[0] — should be filtered out
      makeRunData({
        scenarioRunId: "scenariorun_aaa",
        status: ScenarioRunStatus.QUEUED,
      }),
      // Unique — should be included
      makeRunData({
        scenarioRunId: "scenariorun_bbb",
        status: ScenarioRunStatus.QUEUED,
      }),
    ];

    it("preserves non-overlapping entries from both sources", () => {
      const result = mergeRunData({ esRuns, queuedRuns });
      expect(result).toHaveLength(3);
      const ids = result.map((r) => r.scenarioRunId);
      expect(ids).toContain("scenariorun_aaa");
      expect(ids).toContain("scenariorun_ccc");
      expect(ids).toContain("scenariorun_bbb");
    });

    it("does not include the duplicate queued entry", () => {
      const result = mergeRunData({ esRuns, queuedRuns });
      const queuedResults = result.filter((r) => r.status === ScenarioRunStatus.QUEUED);
      expect(queuedResults).toHaveLength(1);
      expect(queuedResults[0]?.scenarioRunId).toBe("scenariorun_bbb");
    });
  });
});
