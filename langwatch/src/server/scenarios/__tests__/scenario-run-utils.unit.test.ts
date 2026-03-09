/**
 * Unit tests for scenario-run merge and deduplication logic.
 *
 * Covers:
 * - ES wins when both sources have data for the same run
 * - Non-overlapping entries from both sources are preserved
 * - Edge cases: no queued jobs, no ES data
 */

import { describe, it, expect } from "vitest";
import { ScenarioRunStatus } from "../../scenarios/scenario-event.enums";
import { buildDeduplicationKey, mergeRunData } from "../scenario-run.utils";
import type { ScenarioRunData } from "../scenario-event.types";

function makeRunData(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "scen_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    name: "Angry refund request",
    description: null,
    metadata: {
      langwatch: {
        targetReferenceId: "target_1",
        targetType: "prompt" as const,
      },
    },
    status: ScenarioRunStatus.SUCCESS,
    results: null,
    messages: [],
    timestamp: 1700000000000,
    durationInMs: 2300,
    ...overrides,
  };
}

describe("buildDeduplicationKey()", () => {
  it("builds key from scenarioId, targetReferenceId, and batchRunId", () => {
    const run = makeRunData();
    expect(buildDeduplicationKey(run)).toBe("scen_1::target_1::batch_1");
  });

  describe("when targetReferenceId is missing", () => {
    it("uses empty string for targetReferenceId", () => {
      const run = makeRunData({ metadata: null });
      expect(buildDeduplicationKey(run)).toBe("scen_1::::batch_1");
    });
  });
});

describe("mergeRunData()", () => {
  describe("given ES and queued rows with no overlap", () => {
    const esRuns = [makeRunData({ scenarioId: "scen_1" })];
    const queuedRuns = [
      makeRunData({
        scenarioId: "scen_2",
        scenarioRunId: "job_2",
        status: ScenarioRunStatus.QUEUED,
        metadata: { langwatch: { targetReferenceId: "target_2", targetType: "prompt" as const } },
      }),
    ];

    it("returns both entries", () => {
      const result = mergeRunData({ esRuns, queuedRuns });
      expect(result).toHaveLength(2);
    });

    it("places ES rows first", () => {
      const result = mergeRunData({ esRuns, queuedRuns });
      expect(result[0]?.scenarioId).toBe("scen_1");
      expect(result[1]?.scenarioId).toBe("scen_2");
    });
  });

  describe("given overlapping entries (same scenario+target+batch)", () => {
    const esRun = makeRunData({
      scenarioId: "scen_1",
      status: ScenarioRunStatus.SUCCESS,
      scenarioRunId: "es_run_1",
    });
    const queuedRun = makeRunData({
      scenarioId: "scen_1",
      status: ScenarioRunStatus.QUEUED,
      scenarioRunId: "job_run_1",
    });

    it("returns only the ES version", () => {
      const result = mergeRunData({ esRuns: [esRun], queuedRuns: [queuedRun] });
      expect(result).toHaveLength(1);
      expect(result[0]?.scenarioRunId).toBe("es_run_1");
      expect(result[0]?.status).toBe(ScenarioRunStatus.SUCCESS);
    });
  });

  describe("given no queued jobs", () => {
    const esRuns = [makeRunData(), makeRunData({ scenarioId: "scen_2", scenarioRunId: "run_2" })];

    it("returns only ES data", () => {
      const result = mergeRunData({ esRuns, queuedRuns: [] });
      expect(result).toHaveLength(2);
      expect(result).toEqual(esRuns);
    });
  });

  describe("given no ES data", () => {
    const queuedRuns = [
      makeRunData({
        scenarioId: "scen_1",
        status: ScenarioRunStatus.QUEUED,
        scenarioRunId: "job_1",
      }),
      makeRunData({
        scenarioId: "scen_2",
        status: ScenarioRunStatus.RUNNING,
        scenarioRunId: "job_2",
        metadata: { langwatch: { targetReferenceId: "target_2", targetType: "prompt" as const } },
      }),
    ];

    it("returns only queued job rows", () => {
      const result = mergeRunData({ esRuns: [], queuedRuns });
      expect(result).toHaveLength(2);
      expect(result[0]?.status).toBe(ScenarioRunStatus.QUEUED);
      expect(result[1]?.status).toBe(ScenarioRunStatus.RUNNING);
    });
  });

  describe("given repeat > 1 with partial completion", () => {
    // 3 queued jobs for the same scenario+target+batch (repeat=3)
    // 1 already completed in ES
    const esRuns = [
      makeRunData({ scenarioId: "scen_1", scenarioRunId: "es_run_0" }),
    ];
    const queuedRuns = [
      makeRunData({ scenarioId: "scen_1", status: ScenarioRunStatus.QUEUED, scenarioRunId: "job_0" }),
      makeRunData({ scenarioId: "scen_1", status: ScenarioRunStatus.QUEUED, scenarioRunId: "job_1" }),
      makeRunData({ scenarioId: "scen_1", status: ScenarioRunStatus.QUEUED, scenarioRunId: "job_2" }),
    ];

    it("keeps surplus queued rows not yet matched by ES", () => {
      const result = mergeRunData({ esRuns, queuedRuns });
      // 1 ES + 2 surplus queued = 3 total
      expect(result).toHaveLength(3);
      expect(result[0]?.scenarioRunId).toBe("es_run_0");
      expect(result.filter((r) => r.status === ScenarioRunStatus.QUEUED)).toHaveLength(2);
    });
  });

  describe("given mixed overlap and unique entries", () => {
    const esRuns = [
      makeRunData({ scenarioId: "scen_1", scenarioRunId: "es_1" }),
      makeRunData({
        scenarioId: "scen_3",
        scenarioRunId: "es_3",
        metadata: { langwatch: { targetReferenceId: "target_3", targetType: "prompt" as const } },
      }),
    ];
    const queuedRuns = [
      // Overlaps with esRuns[0] — should be filtered out
      makeRunData({
        scenarioId: "scen_1",
        status: ScenarioRunStatus.QUEUED,
        scenarioRunId: "job_1",
      }),
      // Unique — should be included
      makeRunData({
        scenarioId: "scen_2",
        status: ScenarioRunStatus.QUEUED,
        scenarioRunId: "job_2",
        metadata: { langwatch: { targetReferenceId: "target_2", targetType: "prompt" as const } },
      }),
    ];

    it("preserves non-overlapping entries from both sources", () => {
      const result = mergeRunData({ esRuns, queuedRuns });
      expect(result).toHaveLength(3);
      const ids = result.map((r) => r.scenarioRunId);
      expect(ids).toContain("es_1");
      expect(ids).toContain("es_3");
      expect(ids).toContain("job_2");
      expect(ids).not.toContain("job_1");
    });
  });
});
