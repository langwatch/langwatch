/**
 * ScenarioRunService
 *
 * Merges data from two sources:
 * 1. ES/ClickHouse scenario events (completed/in-progress runs)
 * 2. BullMQ queue (waiting/active jobs)
 *
 * Deduplicates by composite key (scenarioId + targetReferenceId + batchRunId + index).
 * ES entries win when both sources have data for the same run.
 */

import type { ScenarioRunData } from "./scenario-event.types";

/**
 * Builds a composite dedup key for a scenario run.
 *
 * Groups by scenarioId + targetReferenceId + batchRunId so that
 * count-based dedup can handle repeats (same scenario+target in one batch).
 */
export function buildDeduplicationKey(run: ScenarioRunData): string {
  const targetRefId = run.metadata?.langwatch?.targetReferenceId ?? "";
  return `${run.scenarioId}::${targetRefId}::${run.batchRunId}`;
}

/**
 * Merges ES/ClickHouse rows with BullMQ job rows, deduplicating so ES wins.
 *
 * Uses count-based dedup per composite key to handle repeats (repeat > 1):
 * if ES has N rows and BullMQ has M rows for the same key, we keep all N ES
 * rows plus max(0, M - N) queued rows (the still-pending ones).
 *
 * @param esRuns - Rows from ES/ClickHouse (completed/in-progress runs)
 * @param queuedRuns - Rows from BullMQ (waiting/active jobs)
 * @returns Merged array with no duplicates; ES entries take precedence
 */
export function mergeRunData({
  esRuns,
  queuedRuns,
}: {
  esRuns: ScenarioRunData[];
  queuedRuns: ScenarioRunData[];
}): ScenarioRunData[] {
  // Count ES rows per composite key
  const esCounts = new Map<string, number>();
  for (const run of esRuns) {
    const key = buildDeduplicationKey(run);
    esCounts.set(key, (esCounts.get(key) ?? 0) + 1);
  }

  // Group queued rows by composite key, then keep surplus (not yet in ES)
  const groupedQueued = new Map<string, ScenarioRunData[]>();
  for (const run of queuedRuns) {
    const key = buildDeduplicationKey(run);
    const group = groupedQueued.get(key) ?? [];
    group.push(run);
    groupedQueued.set(key, group);
  }

  const remainingQueued: ScenarioRunData[] = [];
  for (const [key, group] of groupedQueued) {
    const esCount = esCounts.get(key) ?? 0;
    const surplus = Math.max(0, group.length - esCount);
    if (surplus > 0) {
      // Keep the last N surplus queued rows (earlier ones are matched by ES)
      remainingQueued.push(...group.slice(group.length - surplus));
    }
  }

  return [...esRuns, ...remainingQueued];
}
