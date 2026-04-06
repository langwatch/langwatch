/**
 * Data transforms for the run history list.
 *
 * Groups flat ScenarioRunData arrays into RunGroup structures by batch, scenario, or target.
 * Computes pass rates and calculates totals.
 */

import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData, SuiteRunSummary } from "~/server/scenarios/scenario-event.types";
import { isOnPlatformSet, ON_PLATFORM_DISPLAY_NAME } from "~/server/scenarios/internal-set-id";
import { computeMetricStats, type MetricStats } from "~/components/shared/MetricStatsTooltip";
import { extractSuiteId, isSuiteSetId } from "~/server/suites/suite-set-id";


/** Valid values for the grouping dimension. */
export const RUN_GROUP_TYPES = ["none", "scenario", "target"] as const;

/** The grouping dimension applied to scenario runs. */
export type RunGroupType = (typeof RUN_GROUP_TYPES)[number];

/** Identifies which view is rendering, to determine available group-by options. */
export type RunViewContext = "suite" | "external" | "all-runs";

/**
 * Returns the group-by options available for a given view context.
 *
 * External sets omit "target" since they have no target resolution.
 * Suite and all-runs views include all options.
 */
export function availableGroupByOptions({
  viewContext,
}: {
  viewContext: RunViewContext;
}): RunGroupType[] {
  if (viewContext === "external") {
    return ["none", "scenario"];
  }
  return ["none", "scenario", "target"];
}

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
  /** Pass rate as percentage (0-100), or null when no runs have a verdict (all stalled/cancelled/in-progress). */
  passRate: number | null;
  passedCount: number;
  failedCount: number;
  stalledCount: number;
  cancelledCount: number;
  /** Runs with an actual verdict: passed + failed (SUCCESS + FAILED + ERROR). */
  completedCount: number;
  totalCount: number;
  inProgressCount: number;
  queuedCount: number;
  totalCost: number | null;
  averageAgentLatencyMs: number | null;
  totalDurationMs: number | null;
  agentLatencyStats: MetricStats | null;
  agentCostStats: MetricStats | null;
  averageAgentCost: number | null;
};

/** Backward-compatible alias for RunGroupSummary. */
export type BatchRunSummary = RunGroupSummary;

/** Aggregate totals across all batch runs. */
export type RunHistoryTotals = {
  runCount: number;
  passedCount: number;
  failedCount: number;
  pendingCount: number;
};

/** Returns the most severe status for a group summary, used for the overall icon. */
export function worstStatus(summary: RunGroupSummary): ScenarioRunStatus {
  if (summary.inProgressCount > 0) return ScenarioRunStatus.IN_PROGRESS;
  if (summary.queuedCount > 0) return ScenarioRunStatus.QUEUED;
  if (summary.stalledCount > 0) return ScenarioRunStatus.STALLED;
  if (summary.failedCount > 0) return ScenarioRunStatus.FAILED;
  if (summary.cancelledCount > 0) return ScenarioRunStatus.CANCELLED;
  return ScenarioRunStatus.SUCCESS;
}


type RunStatusCategory = "success" | "failure" | "stalled" | "cancelled" | "in_progress" | "queued";

function categorizeRunStatus(status: ScenarioRunStatus): RunStatusCategory {
  switch (status) {
    case ScenarioRunStatus.SUCCESS:
      return "success";
    case ScenarioRunStatus.ERROR:
    case ScenarioRunStatus.FAILED:
      return "failure";
    case ScenarioRunStatus.STALLED:
      return "stalled";
    case ScenarioRunStatus.CANCELLED:
      return "cancelled";
    case ScenarioRunStatus.IN_PROGRESS:
    case ScenarioRunStatus.PENDING:
    case ScenarioRunStatus.RUNNING:
      return "in_progress";
    case ScenarioRunStatus.QUEUED:
      return "queued";
  }
}

const UNKNOWN_GROUP_KEY = "__unknown__";

/**
 * Computes the maximum timestamp from a list of scenario runs.
 * Used for scenario/target groups where "most recently active" ordering makes sense.
 */
function maxTimestamp(runs: ScenarioRunData[]): number {
  return runs.reduce((max, r) => Math.max(max, r.timestamp), 0);
}

/**
 * Computes the minimum timestamp from a list of scenario runs.
 * Used as the batch "creation time" so batches maintain stable ordering
 * even when individual runs within them get updated.
 */
function minTimestamp(runs: ScenarioRunData[]): number {
  return runs.reduce((min, r) => Math.min(min, r.timestamp), Infinity);
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
 * Each batch uses the minimum timestamp (creation time) from its scenario runs
 * so batches maintain stable ordering even when individual runs update.
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
    const timestamp = minTimestamp(scenarioRuns);
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
 * Pass rate = passed / settled. "Settled" = passed + failed + stalled + cancelled
 * (all terminal states). Only in-progress and queued runs are excluded from the
 * denominator since we don't know their outcome yet.
 * When no runs have settled yet (settledCount == 0), passRate is null.
 */
export function computeGroupSummary({
  group,
}: {
  group: RunGroup;
}): RunGroupSummary {
  let passedCount = 0;
  let failedCount = 0;
  let stalledCount = 0;
  let cancelledCount = 0;
  let inProgressCount = 0;
  let queuedCount = 0;

  for (const run of group.scenarioRuns) {
    switch (categorizeRunStatus(run.status)) {
      case "success":
        passedCount++;
        break;
      case "failure":
        failedCount++;
        break;
      case "stalled":
        stalledCount++;
        break;
      case "cancelled":
        cancelledCount++;
        break;
      case "in_progress":
        inProgressCount++;
        break;
      case "queued":
        queuedCount++;
        break;
    }
  }

  const completedCount = passedCount + failedCount;
  const settledCount = passedCount + failedCount + stalledCount + cancelledCount;
  const totalCount = group.scenarioRuns.length;
  const passRate = settledCount > 0
    ? (passedCount / settledCount) * 100
    : (totalCount > 0 ? null : 0);

  let totalCost = 0;
  let totalDurationMs = 0;
  const allAgentLatencies: number[] = [];
  const allAgentCosts: number[] = [];
  for (const run of group.scenarioRuns) {
    if (run.totalCost != null) totalCost += run.totalCost;
    if (run.durationInMs > 0) totalDurationMs += run.durationInMs;
    const agentLatencies = run.roleLatencies?.["Agent"];
    if (agentLatencies) {
      allAgentLatencies.push(...agentLatencies);
    }
    const agentCosts = run.roleCosts?.["Agent"];
    if (agentCosts) {
      allAgentCosts.push(...agentCosts);
    }
  }

  const agentLatencyStats = computeMetricStats(allAgentLatencies);
  const agentCostStats = computeMetricStats(allAgentCosts);

  return {
    passRate,
    passedCount,
    failedCount,
    stalledCount,
    cancelledCount,
    completedCount,
    totalCount,
    inProgressCount,
    queuedCount,
    totalCost: totalCost > 0 ? totalCost : null,
    averageAgentLatencyMs: agentLatencyStats?.avg ?? null,
    totalDurationMs: totalDurationMs > 0 ? totalDurationMs : null,
    agentLatencyStats,
    agentCostStats,
    averageAgentCost: agentCostStats?.avg ?? null,
  };
}

const MAX_DISPLAYED_SCENARIO_NAMES = 3;

/**
 * Extracts unique scenario display names from a batch run's scenario runs,
 * sorted alphabetically. Falls back to scenarioId when name is null/undefined.
 * Truncates to first 3 names with "+N more" format when there are more.
 */
export function getScenarioDisplayNames({
  scenarioRuns,
}: {
  scenarioRuns: ScenarioRunData[];
}): string {
  if (scenarioRuns.length === 0) return "";

  const uniqueNames = [
    ...new Set(scenarioRuns.map((run) => run.name || run.scenarioId)),
  ].sort((a, b) => a.localeCompare(b));

  const displayed = uniqueNames.slice(0, MAX_DISPLAYED_SCENARIO_NAMES);
  const remaining = uniqueNames.length - displayed.length;

  if (remaining > 0) {
    return `${displayed.join(", ")} +${remaining} more`;
  }

  return displayed.join(", ");
}

/**
 * Computes iteration numbers for scenario runs that share the same
 * scenario + target combination within a batch.
 *
 * Returns a Map from scenarioRunId to iteration number (1-based).
 * Only includes entries for runs where there are multiple iterations
 * (i.e., the same scenario+target pair appears more than once).
 */
export function computeIterationMap({
  scenarioRuns,
}: {
  scenarioRuns: ScenarioRunData[];
}): Map<string, number> {
  const keyCounters = new Map<string, string[]>();

  for (const run of scenarioRuns) {
    const targetId = getTargetReferenceId(run) ?? "";
    const key = `${run.scenarioId}::${targetId}`;
    const ids = keyCounters.get(key);
    if (ids) {
      ids.push(run.scenarioRunId);
    } else {
      keyCounters.set(key, [run.scenarioRunId]);
    }
  }

  const iterationMap = new Map<string, number>();
  for (const ids of keyCounters.values()) {
    if (ids.length > 1) {
      // Sort by scenarioRunId (KSUID) for stable ordering — iteration numbers
      // won't shift when runs are cancelled/filtered from the array.
      const sorted = [...ids].sort((a, b) => a.localeCompare(b));
      for (let i = 0; i < sorted.length; i++) {
        iterationMap.set(sorted[i]!, i + 1);
      }
    }
  }

  return iterationMap;
}

/**
 * Builds a display title in the format: "Target: Scenario (#N)".
 * Omits target prefix and iteration suffix when not available.
 */
export function buildDisplayTitle({
  scenarioName,
  targetName,
  iteration,
}: {
  scenarioName: string;
  targetName: string | null;
  iteration?: number;
}): string {
  let title = targetName ? `${targetName}: ${scenarioName}` : scenarioName;
  if (iteration != null) title += ` (#${iteration})`;
  return title;
}

/**
 * Resolves the origin label for a batch run in the All Runs panel.
 *
 * - On-platform runs (matching __internal__<projectId>__on-platform-scenarios): returns friendly display name
 * - Suite runs (matching __internal__<suiteId>__suite pattern): returns the suite name from suiteNameMap
 * - External runs: returns the raw scenario set ID as the label
 * - No set ID: returns null
 */
export function resolveOriginLabel({
  scenarioSetId,
  suiteNameMap,
}: {
  scenarioSetId: string | undefined;
  suiteNameMap: Map<string, string>;
}): string | null {
  if (!scenarioSetId) return null;

  if (isOnPlatformSet(scenarioSetId)) return ON_PLATFORM_DISPLAY_NAME;

  if (isSuiteSetId(scenarioSetId)) {
    const suiteId = extractSuiteId(scenarioSetId);
    if (!suiteId) return null;
    return suiteNameMap.get(suiteId) ?? null;
  }

  return scenarioSetId;
}

/**
 * Computes aggregate totals from raw scenario runs.
 * Works regardless of grouping mode since it operates on flat runs.
 */
export function computeRunHistoryTotals({
  runs,
}: {
  runs: ScenarioRunData[];
}): RunHistoryTotals {
  let passedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  for (const run of runs) {
    const category = categorizeRunStatus(run.status);
    if (category === "success") passedCount++;
    else if (category === "failure" || category === "stalled" || category === "cancelled") failedCount++;
    else if (category === "queued" || category === "in_progress") pendingCount++;
  }

  return {
    runCount: runs.length,
    passedCount,
    failedCount,
    pendingCount,
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
      failedCount: summary.failedCount,
      totalCount: summary.totalCount,
      lastRunTimestamp: latestBatch.timestamp,
    });
  }

  return map;
}
