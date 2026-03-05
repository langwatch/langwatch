import { describe, it, expect } from "vitest";
import {
  groupRunsByBatchId,
  groupRunsByScenarioId,
  groupRunsByTarget,
  computeBatchRunSummary,
  computeRunHistoryTotals,
  computeSuiteRunSummaries,
  getScenarioDisplayNames,
} from "../run-history-transforms";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { makeBatchRun, makeScenarioRunData } from "./test-helpers";

describe("groupRunsByBatchId()", () => {
  describe("when given an empty array", () => {
    it("returns an empty array", () => {
      const result = groupRunsByBatchId({ runs: [] });
      expect(result).toEqual([]);
    });
  });

  describe("when given runs from a single batch", () => {
    it("groups them into one batch run", () => {
      const runs = [
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_1",
          scenarioId: "scen_1",
        }),
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_2",
          scenarioId: "scen_2",
        }),
      ];

      const result = groupRunsByBatchId({ runs });
      expect(result).toHaveLength(1);
      expect(result[0]!.batchRunId).toBe("batch_1");
      expect(result[0]!.scenarioRuns).toHaveLength(2);
    });
  });

  describe("when given runs from multiple batches", () => {
    it("groups them into separate batch runs sorted by timestamp descending", () => {
      const now = Date.now();
      const runs = [
        makeScenarioRunData({
          batchRunId: "batch_old",
          scenarioRunId: "run_1",
          timestamp: now - 10000,
        }),
        makeScenarioRunData({
          batchRunId: "batch_new",
          scenarioRunId: "run_2",
          timestamp: now,
        }),
        makeScenarioRunData({
          batchRunId: "batch_old",
          scenarioRunId: "run_3",
          timestamp: now - 9000,
        }),
      ];

      const result = groupRunsByBatchId({ runs });
      expect(result).toHaveLength(2);
      expect(result[0]!.batchRunId).toBe("batch_new");
      expect(result[1]!.batchRunId).toBe("batch_old");
    });
  });
});

describe("groupRunsByBatchId() with scenarioSetIds", () => {
  describe("when given an empty array", () => {
    it("returns an empty array", () => {
      const result = groupRunsByBatchId({
        runs: [],
        scenarioSetIds: {},
      });
      expect(result).toEqual([]);
    });
  });

  describe("when given runs with scenario set IDs", () => {
    it("groups runs and includes scenarioSetId for each batch", () => {
      const runs = [
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_1",
          scenarioId: "scen_1",
        }),
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_2",
          scenarioId: "scen_2",
        }),
        makeScenarioRunData({
          batchRunId: "batch_2",
          scenarioRunId: "run_3",
          scenarioId: "scen_3",
        }),
      ];

      const scenarioSetIds = {
        batch_1: "__internal__suite_abc__suite",
        batch_2: "__internal__suite_xyz__suite",
      };

      const result = groupRunsByBatchId({ runs, scenarioSetIds });
      expect(result).toHaveLength(2);
      expect(result[0]!.scenarioSetId).toBe("__internal__suite_abc__suite");
      expect(result[1]!.scenarioSetId).toBe("__internal__suite_xyz__suite");
    });
  });

  describe("when scenarioSetId is missing for a batch", () => {
    it("sets scenarioSetId to undefined", () => {
      const runs = [
        makeScenarioRunData({
          batchRunId: "batch_orphan",
          scenarioRunId: "run_1",
        }),
      ];

      const result = groupRunsByBatchId({
        runs,
        scenarioSetIds: {},
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.scenarioSetId).toBeUndefined();
    });
  });

  describe("when given runs from multiple batches", () => {
    it("sorts batches by timestamp descending", () => {
      const now = Date.now();
      const runs = [
        makeScenarioRunData({
          batchRunId: "batch_old",
          scenarioRunId: "run_1",
          timestamp: now - 10000,
        }),
        makeScenarioRunData({
          batchRunId: "batch_new",
          scenarioRunId: "run_2",
          timestamp: now,
        }),
      ];

      const scenarioSetIds = {
        batch_old: "__internal__suite_1__suite",
        batch_new: "__internal__suite_2__suite",
      };

      const result = groupRunsByBatchId({ runs, scenarioSetIds });
      expect(result).toHaveLength(2);
      expect(result[0]!.batchRunId).toBe("batch_new");
      expect(result[1]!.batchRunId).toBe("batch_old");
    });
  });
});

describe("computeBatchRunSummary()", () => {
  describe("when all scenario runs passed", () => {
    it("returns 100% pass rate", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS }),
          makeScenarioRunData({
            status: ScenarioRunStatus.SUCCESS,
            scenarioRunId: "run_2",
          }),
        ],
      });

      const summary = computeBatchRunSummary({ batchRun });
      expect(summary.passRate).toBe(100);
      expect(summary.passedCount).toBe(2);
      expect(summary.failedCount).toBe(0);
      expect(summary.totalCount).toBe(2);
    });
  });

  describe("when some scenario runs failed", () => {
    it("returns the correct pass rate", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS }),
          makeScenarioRunData({
            status: ScenarioRunStatus.ERROR,
            scenarioRunId: "run_2",
          }),
          makeScenarioRunData({
            status: ScenarioRunStatus.SUCCESS,
            scenarioRunId: "run_3",
          }),
        ],
      });

      const summary = computeBatchRunSummary({ batchRun });
      expect(summary.passRate).toBeCloseTo(66.67, 0);
      expect(summary.passedCount).toBe(2);
      expect(summary.failedCount).toBe(1);
    });
  });

  describe("when batch has no runs", () => {
    it("returns 0% pass rate", () => {
      const batchRun = makeBatchRun({ scenarioRuns: [] });

      const summary = computeBatchRunSummary({ batchRun });
      expect(summary.passRate).toBe(0);
      expect(summary.passedCount).toBe(0);
      expect(summary.failedCount).toBe(0);
    });
  });

  describe("when some runs are still in progress", () => {
    it("only counts finished runs for pass rate", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS }),
          makeScenarioRunData({
            status: ScenarioRunStatus.IN_PROGRESS,
            scenarioRunId: "run_2",
          }),
        ],
      });

      const summary = computeBatchRunSummary({ batchRun });
      expect(summary.passRate).toBe(100);
      expect(summary.passedCount).toBe(1);
      expect(summary.failedCount).toBe(0);
      expect(summary.totalCount).toBe(2);
      expect(summary.inProgressCount).toBe(1);
    });
  });
});

describe("computeRunHistoryTotals()", () => {
  describe("when given multiple runs", () => {
    it("sums up totals across all runs", () => {
      const runs = [
        makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS, scenarioRunId: "run_1" }),
        makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS, scenarioRunId: "run_2" }),
        makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS, scenarioRunId: "run_3" }),
        makeScenarioRunData({ status: ScenarioRunStatus.ERROR, scenarioRunId: "run_4" }),
      ];

      const totals = computeRunHistoryTotals({ runs });
      expect(totals.runCount).toBe(4);
      expect(totals.passedCount).toBe(3);
      expect(totals.failedCount).toBe(1);
    });
  });

  describe("when given an empty array", () => {
    it("returns zeros", () => {
      const totals = computeRunHistoryTotals({ runs: [] });
      expect(totals.runCount).toBe(0);
      expect(totals.passedCount).toBe(0);
      expect(totals.failedCount).toBe(0);
    });
  });

  describe("when given stalled and cancelled runs", () => {
    it("counts them as failed", () => {
      const runs = [
        makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS, scenarioRunId: "run_1" }),
        makeScenarioRunData({ status: ScenarioRunStatus.STALLED, scenarioRunId: "run_2" }),
        makeScenarioRunData({ status: ScenarioRunStatus.CANCELLED, scenarioRunId: "run_3" }),
      ];

      const totals = computeRunHistoryTotals({ runs });
      expect(totals.runCount).toBe(3);
      expect(totals.passedCount).toBe(1);
      expect(totals.failedCount).toBe(2);
    });
  });
});

describe("RunGroup type", () => {
  describe("when any grouping mode completes", () => {
    it("returns groups with groupKey, groupLabel, groupType, timestamp, and scenarioRuns", () => {
      const runs = [
        makeScenarioRunData({ scenarioId: "s1", scenarioRunId: "run_1", name: "Login" }),
      ];

      const groups = groupRunsByScenarioId({ runs });

      expect(groups).toHaveLength(1);
      const group = groups[0]!;
      expect(group).toHaveProperty("groupKey");
      expect(group).toHaveProperty("groupLabel");
      expect(group).toHaveProperty("groupType");
      expect(group).toHaveProperty("timestamp");
      expect(group).toHaveProperty("scenarioRuns");
    });
  });
});

describe("groupRunsByScenarioId()", () => {
  describe("when given an empty array", () => {
    it("returns an empty array", () => {
      const result = groupRunsByScenarioId({ runs: [] });
      expect(result).toEqual([]);
    });
  });

  describe("when given runs with different scenarioIds", () => {
    it("groups runs by scenarioId", () => {
      const runs = [
        makeScenarioRunData({ scenarioId: "s1", scenarioRunId: "run_1", name: "Login" }),
        makeScenarioRunData({ scenarioId: "s1", scenarioRunId: "run_2", name: "Login" }),
        makeScenarioRunData({ scenarioId: "s2", scenarioRunId: "run_3", name: "Signup" }),
        makeScenarioRunData({ scenarioId: "s2", scenarioRunId: "run_4", name: "Signup" }),
        makeScenarioRunData({ scenarioId: "s2", scenarioRunId: "run_5", name: "Signup" }),
      ];

      const result = groupRunsByScenarioId({ runs });

      expect(result).toHaveLength(2);
      const s1Group = result.find((g) => g.groupKey === "s1");
      const s2Group = result.find((g) => g.groupKey === "s2");
      expect(s1Group!.scenarioRuns).toHaveLength(2);
      expect(s2Group!.scenarioRuns).toHaveLength(3);
    });

    it("uses the scenario name as groupLabel", () => {
      const runs = [
        makeScenarioRunData({ scenarioId: "s1", scenarioRunId: "run_1", name: "Login" }),
      ];

      const result = groupRunsByScenarioId({ runs });

      expect(result[0]!.groupLabel).toBe("Login");
    });

    it("sets groupType to scenario", () => {
      const runs = [
        makeScenarioRunData({ scenarioId: "s1", scenarioRunId: "run_1" }),
      ];

      const result = groupRunsByScenarioId({ runs });

      expect(result[0]!.groupType).toBe("scenario");
    });
  });

  describe("when groups have different timestamps", () => {
    it("sorts groups by most recent timestamp descending", () => {
      const runs = [
        makeScenarioRunData({ scenarioId: "s1", scenarioRunId: "run_1", timestamp: 1000 }),
        makeScenarioRunData({ scenarioId: "s2", scenarioRunId: "run_2", timestamp: 3000 }),
        makeScenarioRunData({ scenarioId: "s3", scenarioRunId: "run_3", timestamp: 2000 }),
      ];

      const result = groupRunsByScenarioId({ runs });

      expect(result[0]!.timestamp).toBe(3000);
      expect(result[1]!.timestamp).toBe(2000);
      expect(result[2]!.timestamp).toBe(1000);
    });
  });
});

describe("groupRunsByTarget()", () => {
  describe("when given an empty array", () => {
    it("returns an empty array", () => {
      const result = groupRunsByTarget({ runs: [], targetNameMap: new Map() });
      expect(result).toEqual([]);
    });
  });

  describe("when given runs with different targetReferenceIds", () => {
    it("groups runs by targetReferenceId", () => {
      const runs = [
        makeScenarioRunData({
          scenarioRunId: "run_1",
          metadata: { langwatch: { targetReferenceId: "agent-1", targetType: "code" } },
        }),
        makeScenarioRunData({
          scenarioRunId: "run_2",
          metadata: { langwatch: { targetReferenceId: "agent-1", targetType: "code" } },
        }),
        makeScenarioRunData({
          scenarioRunId: "run_3",
          metadata: { langwatch: { targetReferenceId: "prompt-1", targetType: "prompt" } },
        }),
      ];
      const targetNameMap = new Map([
        ["agent-1", "Agent One"],
        ["prompt-1", "Prompt One"],
      ]);

      const result = groupRunsByTarget({ runs, targetNameMap });

      expect(result).toHaveLength(2);
      const agent1Group = result.find((g) => g.groupKey === "agent-1");
      const prompt1Group = result.find((g) => g.groupKey === "prompt-1");
      expect(agent1Group!.scenarioRuns).toHaveLength(2);
      expect(prompt1Group!.scenarioRuns).toHaveLength(1);
    });

    it("resolves groupLabel from targetNameMap", () => {
      const runs = [
        makeScenarioRunData({
          scenarioRunId: "run_1",
          metadata: { langwatch: { targetReferenceId: "agent-1", targetType: "code" } },
        }),
      ];
      const targetNameMap = new Map([["agent-1", "My Agent"]]);

      const result = groupRunsByTarget({ runs, targetNameMap });

      expect(result[0]!.groupLabel).toBe("My Agent");
    });

    it("sets groupType to target", () => {
      const runs = [
        makeScenarioRunData({
          scenarioRunId: "run_1",
          metadata: { langwatch: { targetReferenceId: "agent-1", targetType: "code" } },
        }),
      ];

      const result = groupRunsByTarget({ runs, targetNameMap: new Map() });

      expect(result[0]!.groupType).toBe("target");
    });
  });

  describe("when runs have no target metadata", () => {
    it("places them in an Unknown group", () => {
      const runs = [
        makeScenarioRunData({ scenarioRunId: "run_1", metadata: undefined }),
        makeScenarioRunData({ scenarioRunId: "run_2", metadata: null }),
        makeScenarioRunData({
          scenarioRunId: "run_3",
          metadata: { langwatch: undefined },
        }),
      ];

      const result = groupRunsByTarget({ runs, targetNameMap: new Map() });

      expect(result).toHaveLength(1);
      expect(result[0]!.groupKey).toBe("__unknown__");
      expect(result[0]!.groupLabel).toBe("Unknown");
      expect(result[0]!.scenarioRuns).toHaveLength(3);
    });
  });

  describe("when groups have different timestamps", () => {
    it("sorts groups by most recent timestamp descending", () => {
      const runs = [
        makeScenarioRunData({
          scenarioRunId: "run_1",
          timestamp: 1000,
          metadata: { langwatch: { targetReferenceId: "a", targetType: "code" } },
        }),
        makeScenarioRunData({
          scenarioRunId: "run_2",
          timestamp: 3000,
          metadata: { langwatch: { targetReferenceId: "b", targetType: "code" } },
        }),
        makeScenarioRunData({
          scenarioRunId: "run_3",
          timestamp: 2000,
          metadata: { langwatch: { targetReferenceId: "c", targetType: "code" } },
        }),
      ];

      const result = groupRunsByTarget({ runs, targetNameMap: new Map() });

      expect(result[0]!.timestamp).toBe(3000);
      expect(result[1]!.timestamp).toBe(2000);
      expect(result[2]!.timestamp).toBe(1000);
    });
  });
});

describe("groupRunsByBatchId() RunGroup fields", () => {
  describe("when grouping by batch", () => {
    it("returns groups with groupType none", () => {
      const runs = [
        makeScenarioRunData({ batchRunId: "batch_1", scenarioRunId: "run_1" }),
      ];

      const result = groupRunsByBatchId({ runs });

      expect(result[0]!.groupType).toBe("none");
      expect(result[0]!.groupKey).toBe("batch_1");
    });
  });
});

describe("computeSuiteRunSummaries()", () => {
  describe("when given no runs", () => {
    it("returns an empty map", () => {
      const result = computeSuiteRunSummaries({
        runs: [],
        scenarioSetIds: {},
      });

      expect(result.size).toBe(0);
    });
  });

  describe("when a suite has all passing runs", () => {
    it("returns correct summary with all passed", () => {
      const now = Date.now();
      const runs = [
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_1",
          status: ScenarioRunStatus.SUCCESS,
          timestamp: now,
        }),
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_2",
          scenarioId: "scen_2",
          status: ScenarioRunStatus.SUCCESS,
          timestamp: now,
        }),
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_3",
          scenarioId: "scen_3",
          status: ScenarioRunStatus.SUCCESS,
          timestamp: now,
        }),
      ];

      const scenarioSetIds = {
        batch_1: "__internal__suite_abc__suite",
      };

      const result = computeSuiteRunSummaries({ runs, scenarioSetIds });

      expect(result.size).toBe(1);
      const summary = result.get("suite_abc");
      expect(summary).toEqual({
        passedCount: 3,
        totalCount: 3,
        lastRunTimestamp: now,
      });
    });
  });

  describe("when a suite has mixed pass/fail runs", () => {
    it("returns correct summary with failures", () => {
      const now = Date.now();
      const runs = [
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_1",
          status: ScenarioRunStatus.SUCCESS,
          timestamp: now,
        }),
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_2",
          scenarioId: "scen_2",
          status: ScenarioRunStatus.ERROR,
          timestamp: now,
        }),
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_3",
          scenarioId: "scen_3",
          status: ScenarioRunStatus.FAILED,
          timestamp: now,
        }),
      ];

      const scenarioSetIds = {
        batch_1: "__internal__suite_xyz__suite",
      };

      const result = computeSuiteRunSummaries({ runs, scenarioSetIds });

      expect(result.size).toBe(1);
      const summary = result.get("suite_xyz");
      expect(summary).toEqual({
        passedCount: 1,
        totalCount: 3,
        lastRunTimestamp: now,
      });
    });
  });

  describe("when runs do not belong to a suite", () => {
    it("ignores non-suite scenarioSetIds", () => {
      const runs = [
        makeScenarioRunData({
          batchRunId: "batch_1",
          scenarioRunId: "run_1",
          status: ScenarioRunStatus.SUCCESS,
        }),
        makeScenarioRunData({
          batchRunId: "batch_2",
          scenarioRunId: "run_2",
          status: ScenarioRunStatus.SUCCESS,
        }),
      ];

      const scenarioSetIds = {
        batch_1: "some-regular-set-id",
        batch_2: "__internal__not-a-suite-id",
      };

      const result = computeSuiteRunSummaries({ runs, scenarioSetIds });

      expect(result.size).toBe(0);
    });
  });
});

describe("getScenarioDisplayNames()", () => {
  describe("when given scenario runs with duplicate names", () => {
    it("returns unique sorted names", () => {
      const scenarioRuns = [
        makeScenarioRunData({ name: "Login Flow", scenarioRunId: "r1" }),
        makeScenarioRunData({ name: "Checkout Flow", scenarioRunId: "r2" }),
        makeScenarioRunData({ name: "Login Flow", scenarioRunId: "r3" }),
      ];

      const result = getScenarioDisplayNames({ scenarioRuns });
      expect(result).toBe("Checkout Flow, Login Flow");
    });
  });

  describe("when a scenario run has null name", () => {
    it("falls back to scenarioId", () => {
      const scenarioRuns = [
        makeScenarioRunData({
          name: null,
          scenarioId: "scenario-abc",
          scenarioRunId: "r1",
        }),
      ];

      const result = getScenarioDisplayNames({ scenarioRuns });
      expect(result).toBe("scenario-abc");
    });
  });

  describe("when a scenario run has undefined name", () => {
    it("falls back to scenarioId", () => {
      const scenarioRuns = [
        makeScenarioRunData({
          name: undefined,
          scenarioId: "scenario-xyz",
          scenarioRunId: "r1",
        }),
      ];

      const result = getScenarioDisplayNames({ scenarioRuns });
      expect(result).toBe("scenario-xyz");
    });
  });

  describe("when there are more than 3 unique names", () => {
    it("truncates to first 3 with +N more", () => {
      const scenarioRuns = [
        makeScenarioRunData({ name: "Alpha", scenarioRunId: "r1" }),
        makeScenarioRunData({ name: "Beta", scenarioRunId: "r2" }),
        makeScenarioRunData({ name: "Gamma", scenarioRunId: "r3" }),
        makeScenarioRunData({ name: "Delta", scenarioRunId: "r4" }),
        makeScenarioRunData({ name: "Epsilon", scenarioRunId: "r5" }),
      ];

      const result = getScenarioDisplayNames({ scenarioRuns });
      expect(result).toBe("Alpha, Beta, Delta +2 more");
    });
  });

  describe("when there are exactly 3 unique names", () => {
    it("displays all 3 without truncation", () => {
      const scenarioRuns = [
        makeScenarioRunData({ name: "Alpha", scenarioRunId: "r1" }),
        makeScenarioRunData({ name: "Beta", scenarioRunId: "r2" }),
        makeScenarioRunData({ name: "Gamma", scenarioRunId: "r3" }),
      ];

      const result = getScenarioDisplayNames({ scenarioRuns });
      expect(result).toBe("Alpha, Beta, Gamma");
    });
  });

  describe("when there are no scenario runs", () => {
    it("returns an empty string", () => {
      const result = getScenarioDisplayNames({ scenarioRuns: [] });
      expect(result).toBe("");
    });
  });

  describe("when there is a single scenario run", () => {
    it("returns the single name", () => {
      const scenarioRuns = [
        makeScenarioRunData({ name: "Login Flow", scenarioRunId: "r1" }),
      ];

      const result = getScenarioDisplayNames({ scenarioRuns });
      expect(result).toBe("Login Flow");
    });
  });
});
