/**
 * Data transforms for the run history list.
 *
 * Groups flat ScenarioRunData arrays into BatchRun structures,
 * computes pass rates, and calculates totals.
 */

import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";

/** A batch run groups all scenario runs that share the same batchRunId. */
export type BatchRun = {
  batchRunId: string;
  timestamp: number;
  scenarioRuns: ScenarioRunData[];
};

/** Summary statistics for a single batch run. */
export type BatchRunSummary = {
  passRate: number;
  passedCount: number;
  failedCount: number;
  totalCount: number;
  inProgressCount: number;
};

/** Aggregate totals across all batch runs. */
export type RunHistoryTotals = {
  runCount: number;
  passedCount: number;
  failedCount: number;
};

const FINISHED_STATUSES = new Set<string>([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.FAILED,
]);

const SUCCESS_STATUSES = new Set<string>([ScenarioRunStatus.SUCCESS]);

/**
 * Groups a flat list of scenario runs by their batchRunId.
 *
 * Returns batch runs sorted by timestamp descending (most recent first).
 * Each batch uses the maximum timestamp from its scenario runs.
 */
export function groupRunsByBatchId({
  runs,
}: {
  runs: ScenarioRunData[];
}): BatchRun[] {
  const batchMap = new Map<string, ScenarioRunData[]>();

  for (const run of runs) {
    const existing = batchMap.get(run.batchRunId);
    if (existing) {
      existing.push(run);
    } else {
      batchMap.set(run.batchRunId, [run]);
    }
  }

  const batchRuns: BatchRun[] = [];
  for (const [batchRunId, scenarioRuns] of batchMap) {
    const timestamp = scenarioRuns.reduce(
      (max, r) => Math.max(max, r.timestamp),
      0,
    );
    batchRuns.push({ batchRunId, timestamp, scenarioRuns });
  }

  batchRuns.sort((a, b) => b.timestamp - a.timestamp);
  return batchRuns;
}

/**
 * Computes pass/fail summary for a single batch run.
 *
 * Only finished runs (SUCCESS, ERROR, FAILED) contribute to the pass rate.
 * In-progress runs are tracked separately.
 */
export function computeBatchRunSummary({
  batchRun,
}: {
  batchRun: BatchRun;
}): BatchRunSummary {
  let passedCount = 0;
  let failedCount = 0;
  let inProgressCount = 0;

  for (const run of batchRun.scenarioRuns) {
    if (SUCCESS_STATUSES.has(run.status)) {
      passedCount++;
    } else if (FINISHED_STATUSES.has(run.status) && !SUCCESS_STATUSES.has(run.status)) {
      failedCount++;
    } else {
      inProgressCount++;
    }
  }

  const finishedCount = passedCount + failedCount;
  const passRate = finishedCount > 0 ? (passedCount / finishedCount) * 100 : 0;

  return {
    passRate,
    passedCount,
    failedCount,
    totalCount: batchRun.scenarioRuns.length,
    inProgressCount,
  };
}

/**
 * Computes aggregate totals across all batch runs.
 */
export function computeRunHistoryTotals({
  batchRuns,
}: {
  batchRuns: BatchRun[];
}): RunHistoryTotals {
  let passedCount = 0;
  let failedCount = 0;

  for (const batchRun of batchRuns) {
    const summary = computeBatchRunSummary({ batchRun });
    passedCount += summary.passedCount;
    failedCount += summary.failedCount;
  }

  return {
    runCount: batchRuns.length,
    passedCount,
    failedCount,
  };
}
