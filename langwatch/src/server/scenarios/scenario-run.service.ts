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
 * For ES rows, uses scenarioId + targetReferenceId + batchRunId.
 * For BullMQ rows, the same fields are populated from job data.
 */
export function buildDeduplicationKey(run: ScenarioRunData): string {
  const targetRefId = run.metadata?.langwatch?.targetReferenceId ?? "";
  return `${run.scenarioId}::${targetRefId}::${run.batchRunId}`;
}

/**
 * Merges ES/ClickHouse rows with BullMQ job rows, deduplicating so ES wins.
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
  // Build a set of keys from ES rows — these take precedence
  const esKeys = new Set<string>();
  for (const run of esRuns) {
    esKeys.add(buildDeduplicationKey(run));
  }

  // Filter out queued rows that already have an ES counterpart
  const uniqueQueuedRuns = queuedRuns.filter(
    (run) => !esKeys.has(buildDeduplicationKey(run)),
  );

  // Combine: ES rows first, then remaining queued rows
  return [...esRuns, ...uniqueQueuedRuns];
}
