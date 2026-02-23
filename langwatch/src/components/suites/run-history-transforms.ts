/**
 * Data transforms for the run history list.
 *
 * Groups flat ScenarioRunData arrays into RunGroup structures by batch, scenario, or target.
 * Computes pass rates and calculates totals.
 */

import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { extractSuiteId, isSuiteSetId } from "~/server/suites/suite-set-id";
import type { SuiteRunSummary } from "./SuiteSidebar";

/** Valid values for the grouping dimension. */
export const RUN_GROUP_TYPES = ["none", "scenario", "target"] as const;

/** The grouping dimension applied to scenario runs. */
export type RunGroupType = (typeof RUN_GROUP_TYPES)[number];

/** A generic group of scenario runs with a consistent shape across all grouping modes. */
export type RunGroup = {
  groupKey: string;
  groupLabel: string;
  groupType: RunGroupType;
  timestamp: number;
  scenarioRuns: ScenarioRunData[];
};

/** A batch run groups all scenario runs that share the same batchRunId. Extends RunGroup for backward compatibility. */
export type BatchRun = RunGroup & {
  batchRunId: string;
  scenarioSetId?: string; // present in All Runs view
};

/** Summary statistics for a run group (batch, scenario, or target). */
export type RunGroupSummary = {
  passRate: number;
  passedCount: number;
  failedCount: number;
  totalCount: number;
  inProgressCount: number;
};

/** Backward-compatible alias for RunGroupSummary. */
export type BatchRunSummary = RunGroupSummary;

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

const UNKNOWN_GROUP_KEY = "__unknown__";

/**
 * Computes the maximum timestamp from a list of scenario runs.
 */
function maxTimestamp(runs: ScenarioRunData[]): number {
  return runs.reduce((max, r) => Math.max(max, r.timestamp), 0);
}

/**
 * Sorts groups by timestamp descending (most recent first). Mutates and returns the array.
 */
function sortByTimestampDesc<T extends RunGroup>(groups: T[]): T[] {
  groups.sort((a, b) => b.timestamp - a.timestamp);
  return groups;
}

/**
 * Groups a flat list of scenario runs by their batchRunId.
 *
 * Returns batch runs sorted by timestamp descending (most recent first).
 * Each batch uses the maximum timestamp from its scenario runs.
 * When scenarioSetIds is provided, each batch run includes its scenarioSetId.
 */
export function groupRunsByBatchId({
  runs,
  scenarioSetIds,
}: {
  runs: ScenarioRunData[];
  scenarioSetIds?: Record<string, string>;
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
    const timestamp = maxTimestamp(scenarioRuns);
    const scenarioSetId = scenarioSetIds?.[batchRunId];
    batchRuns.push({
      groupKey: batchRunId,
      groupLabel: batchRunId,
      groupType: "none",
      batchRunId,
      timestamp,
      scenarioRuns,
      scenarioSetId,
    });
  }

  return sortByTimestampDesc(batchRuns);
}

/**
 * Groups a flat list of scenario runs by their scenarioId.
 *
 * Returns groups sorted by timestamp descending (most recent first).
 * Uses the scenario's name as the group label.
 */
export function groupRunsByScenarioId({
  runs,
}: {
  runs: ScenarioRunData[];
}): RunGroup[] {
  const scenarioMap = new Map<string, ScenarioRunData[]>();

  for (const run of runs) {
    const existing = scenarioMap.get(run.scenarioId);
    if (existing) {
      existing.push(run);
    } else {
      scenarioMap.set(run.scenarioId, [run]);
    }
  }

  const groups: RunGroup[] = [];
  for (const [scenarioId, scenarioRuns] of scenarioMap) {
    const label = scenarioRuns[0]?.name ?? scenarioId;
    groups.push({
      groupKey: scenarioId,
      groupLabel: label,
      groupType: "scenario",
      timestamp: maxTimestamp(scenarioRuns),
      scenarioRuns,
    });
  }

  return sortByTimestampDesc(groups);
}

/**
 * Extracts the targetReferenceId from a scenario run's metadata, or returns undefined.
 */
function getTargetReferenceId(run: ScenarioRunData): string | undefined {
  return run.metadata?.langwatch?.targetReferenceId;
}

/**
 * Groups a flat list of scenario runs by their target (metadata.langwatch.targetReferenceId).
 *
 * Returns groups sorted by timestamp descending (most recent first).
 * Resolves the display name from targetNameMap; runs without target metadata
 * are placed in an "Unknown" group.
 */
export function groupRunsByTarget({
  runs,
  targetNameMap,
}: {
  runs: ScenarioRunData[];
  targetNameMap: Map<string, string>;
}): RunGroup[] {
  const targetMap = new Map<string, ScenarioRunData[]>();

  for (const run of runs) {
    const targetId = getTargetReferenceId(run) ?? UNKNOWN_GROUP_KEY;
    const existing = targetMap.get(targetId);
    if (existing) {
      existing.push(run);
    } else {
      targetMap.set(targetId, [run]);
    }
  }

  const groups: RunGroup[] = [];
  for (const [targetId, scenarioRuns] of targetMap) {
    const label =
      targetId === UNKNOWN_GROUP_KEY
        ? "Unknown"
        : targetNameMap.get(targetId) ?? targetId;
    groups.push({
      groupKey: targetId,
      groupLabel: label,
      groupType: "target",
      timestamp: maxTimestamp(scenarioRuns),
      scenarioRuns,
    });
  }

  return sortByTimestampDesc(groups);
}

/**
 * Computes pass/fail summary for a single batch run.
 * Delegates to computeGroupSummary since BatchRun extends RunGroup.
 */
export function computeBatchRunSummary({
  batchRun,
}: {
  batchRun: BatchRun;
}): RunGroupSummary {
  return computeGroupSummary({ group: batchRun });
}

/**
 * Computes pass/fail summary for any RunGroup (batch, scenario, or target).
 *
 * Only finished runs (SUCCESS, ERROR, FAILED) contribute to the pass rate.
 * In-progress runs are tracked separately.
 */
export function computeGroupSummary({
  group,
}: {
  group: RunGroup;
}): RunGroupSummary {
  let passedCount = 0;
  let failedCount = 0;
  let inProgressCount = 0;

  for (const run of group.scenarioRuns) {
    if (SUCCESS_STATUSES.has(run.status)) {
      passedCount++;
    } else if (FINISHED_STATUSES.has(run.status)) {
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
    totalCount: group.scenarioRuns.length,
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

/**
 * Computes run summaries for each suite from flat scenario run data.
 *
 * Groups runs by suite (via scenarioSetIds), finds the most recent batch
 * for each suite, and returns pass/fail summary for that batch.
 */
export function computeSuiteRunSummaries({
  runs,
  scenarioSetIds,
}: {
  runs: ScenarioRunData[];
  scenarioSetIds: Record<string, string>;
}): Map<string, SuiteRunSummary> {
  const map = new Map<string, SuiteRunSummary>();

  // Group runs by suite: scenarioSetIds maps batchRunId -> scenarioSetId
  const runsBySuite = new Map<string, ScenarioRunData[]>();
  for (const run of runs) {
    const scenarioSetId = scenarioSetIds[run.batchRunId];
    if (!scenarioSetId || !isSuiteSetId(scenarioSetId)) continue;
    const suiteId = extractSuiteId(scenarioSetId);
    if (!suiteId) continue;

    const existing = runsBySuite.get(suiteId);
    if (existing) {
      existing.push(run);
    } else {
      runsBySuite.set(suiteId, [run]);
    }
  }

  // For each suite, get the most recent batch run and compute its summary
  for (const [suiteId, suiteRuns] of runsBySuite) {
    const batchRuns = groupRunsByBatchId({ runs: suiteRuns });
    const latestBatch = batchRuns[0]; // already sorted by timestamp desc
    if (!latestBatch) continue;

    const summary = computeBatchRunSummary({ batchRun: latestBatch });
    map.set(suiteId, {
      passedCount: summary.passedCount,
      totalCount: summary.totalCount,
      lastRunTimestamp: latestBatch.timestamp,
    });
  }

  return map;
}
