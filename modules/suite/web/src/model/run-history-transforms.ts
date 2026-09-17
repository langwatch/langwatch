/**
 * Data transforms for the run history list: groups flat scenario-run data
 * into batch/scenario/target groups, computing pass rates and totals.
 */

import {
  SimulationRunStatus as ScenarioRunStatus,
  type SimulationRunData as ScenarioRunData,
} from "@langwatch/scenario-contract";

type SuiteRunSummary = {
  passedCount: number;
  failedCount: number;
  totalCount: number;
  lastRunTimestamp: number | null;
};

export type MetricStats = {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
};

function computeMetricStats(values: number[]): MetricStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].toSorted((a, b) => a - b);
  const percentile = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
  };
}

function categorizeRunStatus(
  status: ScenarioRunStatus,
): "success" | "failure" | "stalled" | "cancelled" | "in_progress" | "queued" {
  switch (status) {
    case ScenarioRunStatus.SUCCESS:
      return "success";
    case ScenarioRunStatus.FAILED:
    case ScenarioRunStatus.ERROR:
      return "failure";
    case ScenarioRunStatus.STALLED:
      return "stalled";
    case ScenarioRunStatus.CANCELLED:
      return "cancelled";
    case ScenarioRunStatus.IN_PROGRESS:
    case ScenarioRunStatus.PENDING:
    case ScenarioRunStatus.RUNNING:
    // The verdict can still change when the evaluator results land, so a
    // history rollup counts the run as still going, matching the polling set.
    case ScenarioRunStatus.PENDING_EVALUATION:
      return "in_progress";
    case ScenarioRunStatus.QUEUED:
      return "queued";
  }
}

const ON_PLATFORM_SET_PREFIX = "__internal__";
const ON_PLATFORM_SET_SUFFIX = "__on-platform-scenarios";
const SUITE_SET_PREFIX = "__internal__";
const SUITE_SET_MARKER = "__suite";
const ON_PLATFORM_DISPLAY_NAME = "Manual Run";

function isOnPlatformSet(id: string): boolean {
  return id.startsWith(ON_PLATFORM_SET_PREFIX) && id.endsWith(ON_PLATFORM_SET_SUFFIX);
}

function isSuiteSetId(id: string): boolean {
  return id.startsWith(SUITE_SET_PREFIX) && id.endsWith(SUITE_SET_MARKER);
}

function extractSuiteId(id: string): string | null {
  if (!isSuiteSetId(id)) return null;
  const start = SUITE_SET_PREFIX.length;
  return id.slice(start, -SUITE_SET_MARKER.length) || null;
}

/** Valid values for the grouping dimension. */
export const RUN_GROUP_TYPES = ["none", "scenario", "target"] as const;

/** The grouping dimension applied to scenario runs. */
export type RunGroupType = (typeof RUN_GROUP_TYPES)[number];

/** Identifies which view is rendering, to determine available group-by options. */
export type RunViewContext = "suite" | "external" | "all-runs";

/**
 * The group-by options available for a view context — external omits
 * "target" (no target resolution); suite and all-runs include everything.
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

/** A batch run groups scenario runs by batchRunId. */
export type BatchRun = RunGroup & {
  batchRunId: string;
  scenarioSetId?: string; // present in All Runs view
};

/** Summary statistics for a run group (batch, scenario, or target). */
export type RunGroupSummary = {
  /** Pass rate as percentage, or null when no runs have settled. */
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
 * Groups scenario runs by `batchRunId`, sorted by timestamp descending.
 * Each batch uses its runs' MINIMUM timestamp so ordering stays stable as
 * individual runs update; `scenarioSetIds`, when given, tags each batch's `scenarioSetId`.
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
 * Groups scenario runs by `scenarioId`, sorted by timestamp descending,
 * labelled with the scenario's name.
 */
export function groupRunsByScenarioId({ runs }: { runs: ScenarioRunData[] }): RunGroup[] {
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

/** Returns the target key for a run, distinguishing agents with different parameters. */
export function targetKeyOfRun(run: ScenarioRunData): string | undefined {
  return run.metadata?.langwatch?.targetKey ?? getTargetReferenceId(run);
}

/** Groups scenario runs by their target key, with unknown runs under "Unknown". */
export function groupRunsByTargetKey({ runs }: { runs: ScenarioRunData[] }): RunGroup[] {
  const targetMap = new Map<string, ScenarioRunData[]>();

  for (const run of runs) {
    const key = targetKeyOfRun(run) ?? UNKNOWN_GROUP_KEY;
    const existing = targetMap.get(key);
    if (existing) {
      existing.push(run);
    } else {
      targetMap.set(key, [run]);
    }
  }

  return [...targetMap].map(([key, scenarioRuns]) => ({
    groupKey: key,
    groupLabel: key === UNKNOWN_GROUP_KEY ? "Unknown" : key,
    groupType: "target",
    timestamp: maxTimestamp(scenarioRuns),
    scenarioRuns,
  }));
}

/**
 * Groups scenario runs by target (`metadata.langwatch.targetReferenceId`),
 * sorted by timestamp descending. Display name resolves from
 * `targetNameMap`; runs without target metadata land in "Unknown".
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
      targetId === UNKNOWN_GROUP_KEY ? "Unknown" : (targetNameMap.get(targetId) ?? targetId);
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
export function computeBatchRunSummary({ batchRun }: { batchRun: BatchRun }): RunGroupSummary {
  return computeGroupSummary({ group: batchRun });
}

/**
 * Computes pass/fail summary for any RunGroup. Keep in sync with the sidebar's
 * ClickHouse query in simulation.clickhouse.repository.ts → getSetSummaries().
 */
export function computeGroupSummary({ group }: { group: RunGroup }): RunGroupSummary {
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
  const passRate =
    settledCount > 0 ? (passedCount / settledCount) * 100 : totalCount > 0 ? null : 0;

  let totalCost = 0;
  let totalDurationMs = 0;
  const allAgentLatencies: number[] = [];
  const allAgentCosts: number[] = [];
  for (const run of group.scenarioRuns) {
    if (run.totalCost != null) totalCost += run.totalCost;
    if (run.durationInMs > 0) totalDurationMs += run.durationInMs;
    const agentLatencies = run.roleLatencies?.Agent;
    if (agentLatencies) {
      allAgentLatencies.push(...agentLatencies);
    }
    const agentCosts = run.roleCosts?.Agent;
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

  const uniqueNames = [...new Set(scenarioRuns.map((run) => run.name || run.scenarioId))].toSorted(
    (a, b) => a.localeCompare(b),
  );

  const displayed = uniqueNames.slice(0, MAX_DISPLAYED_SCENARIO_NAMES);
  const remaining = uniqueNames.length - displayed.length;

  if (remaining > 0) {
    return `${displayed.join(", ")} +${remaining} more`;
  }

  return displayed.join(", ");
}

/** Maps scenario runs to iteration numbers by scenario+target combination. */
export function computeIterationMap({
  scenarioRuns,
}: {
  scenarioRuns: ScenarioRunData[];
}): Map<string, number> {
  const keyCounters = new Map<string, string[]>();

  for (const run of scenarioRuns) {
    const targetKey = targetKeyOfRun(run) ?? "";
    const key = `${run.scenarioId}::${targetKey}`;
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
      const sorted = [...ids].toSorted((a, b) => a.localeCompare(b));
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

/** Resolves a batch run's origin label: on-platform, suite, external, or null. */
export function resolveOriginLabel({
  scenarioSetId,
  suiteNameMap,
  onPlatformLabel,
}: {
  scenarioSetId: string | undefined;
  suiteNameMap: Map<string, string>;
  onPlatformLabel?: string;
}): string | null {
  if (!scenarioSetId) return null;

  if (isOnPlatformSet(scenarioSetId)) {
    return onPlatformLabel ?? ON_PLATFORM_DISPLAY_NAME;
  }

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
export function computeRunHistoryTotals({ runs }: { runs: ScenarioRunData[] }): RunHistoryTotals {
  let passedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  for (const run of runs) {
    const category = categorizeRunStatus(run.status);
    if (category === "success") passedCount++;
    else if (category === "failure" || category === "stalled" || category === "cancelled")
      failedCount++;
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
 * Run summaries per suite: groups by `scenarioSetIds`, finds each suite's
 * most recent batch, and returns its pass/fail summary.
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
