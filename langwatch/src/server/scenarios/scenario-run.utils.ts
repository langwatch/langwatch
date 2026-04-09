/**
 * Scenario Run Merge Helpers
 *
 * Merges data from two sources:
 * 1. ES/ClickHouse scenario events (completed/in-progress runs)
 * 2. BullMQ queue (waiting/active jobs)
 *
 * Deduplicates by scenarioRunId — each queued job now carries the same
 * pre-assigned ID that the SDK uses, so a direct ID match is sufficient.
 * Stored entries (ES/ClickHouse) win when both sources share an ID.
 */

import type { ScenarioRunData } from "./scenario-event.types";

/**
 * Merges stored rows with BullMQ job rows, deduplicating by scenarioRunId.
 *
 * Queued rows whose scenarioRunId already appears in the stored set are
 * dropped — the stored version is authoritative. Queued rows with IDs
 * not yet in the stored set are appended (they represent pending jobs).
 *
 * @param esRuns - Rows from ES/ClickHouse (completed/in-progress runs)
 * @param queuedRuns - Rows from BullMQ (waiting/active jobs)
 * @returns Merged array with no duplicates; stored entries take precedence
 */
export function mergeRunData({
  esRuns,
  queuedRuns,
}: {
  esRuns: ScenarioRunData[];
  queuedRuns: ScenarioRunData[];
}): ScenarioRunData[] {
  const storedIds = new Set(esRuns.map((run) => run.scenarioRunId));

  const remainingQueued = queuedRuns.filter(
    (run) => !storedIds.has(run.scenarioRunId),
  );

  return [...esRuns, ...remainingQueued];
}
