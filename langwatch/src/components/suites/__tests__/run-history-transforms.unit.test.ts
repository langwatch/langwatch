import { describe, it, expect } from "vitest";
import {
  groupRunsByBatchId,
  computeBatchRunSummary,
  computeRunHistoryTotals,
  type BatchRun,
} from "../run-history-transforms";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import { makeScenarioRunData } from "./test-helpers";

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
      const batchRun: BatchRun = {
        batchRunId: "batch_1",
        timestamp: Date.now(),
        scenarioRuns: [
          makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS }),
          makeScenarioRunData({
            status: ScenarioRunStatus.SUCCESS,
            scenarioRunId: "run_2",
          }),
        ],
      };

      const summary = computeBatchRunSummary({ batchRun });
      expect(summary.passRate).toBe(100);
      expect(summary.passedCount).toBe(2);
      expect(summary.failedCount).toBe(0);
      expect(summary.totalCount).toBe(2);
    });
  });

  describe("when some scenario runs failed", () => {
    it("returns the correct pass rate", () => {
      const batchRun: BatchRun = {
        batchRunId: "batch_1",
        timestamp: Date.now(),
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
      };

      const summary = computeBatchRunSummary({ batchRun });
      expect(summary.passRate).toBeCloseTo(66.67, 0);
      expect(summary.passedCount).toBe(2);
      expect(summary.failedCount).toBe(1);
    });
  });

  describe("when batch has no runs", () => {
    it("returns 0% pass rate", () => {
      const batchRun: BatchRun = {
        batchRunId: "batch_1",
        timestamp: Date.now(),
        scenarioRuns: [],
      };

      const summary = computeBatchRunSummary({ batchRun });
      expect(summary.passRate).toBe(0);
      expect(summary.passedCount).toBe(0);
      expect(summary.failedCount).toBe(0);
    });
  });

  describe("when some runs are still in progress", () => {
    it("only counts finished runs for pass rate", () => {
      const batchRun: BatchRun = {
        batchRunId: "batch_1",
        timestamp: Date.now(),
        scenarioRuns: [
          makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS }),
          makeScenarioRunData({
            status: ScenarioRunStatus.IN_PROGRESS,
            scenarioRunId: "run_2",
          }),
        ],
      };

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
  describe("when given multiple batch runs", () => {
    it("sums up totals across all batches", () => {
      const batchRuns: BatchRun[] = [
        {
          batchRunId: "batch_1",
          timestamp: Date.now(),
          scenarioRuns: [
            makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS }),
            makeScenarioRunData({
              status: ScenarioRunStatus.SUCCESS,
              scenarioRunId: "run_2",
            }),
          ],
        },
        {
          batchRunId: "batch_2",
          timestamp: Date.now() - 1000,
          scenarioRuns: [
            makeScenarioRunData({
              status: ScenarioRunStatus.SUCCESS,
              batchRunId: "batch_2",
              scenarioRunId: "run_3",
            }),
            makeScenarioRunData({
              status: ScenarioRunStatus.ERROR,
              batchRunId: "batch_2",
              scenarioRunId: "run_4",
            }),
          ],
        },
      ];

      const totals = computeRunHistoryTotals({ batchRuns });
      expect(totals.runCount).toBe(2);
      expect(totals.passedCount).toBe(3);
      expect(totals.failedCount).toBe(1);
    });
  });

  describe("when given an empty array", () => {
    it("returns zeros", () => {
      const totals = computeRunHistoryTotals({ batchRuns: [] });
      expect(totals.runCount).toBe(0);
      expect(totals.passedCount).toBe(0);
      expect(totals.failedCount).toBe(0);
    });
  });
});
