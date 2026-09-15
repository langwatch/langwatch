/** Scenario Run Merge Helpers: deduplicates ES/ClickHouse runs and queued
 * jobs by scenarioRunId; stored entries take precedence.
 */

import type { ScenarioRunData } from "./scenario-run-data.ts";

/** Merges stored and queued runs, dropping queued duplicates; stored entries
 * take precedence.
 */
export function mergeRunData({
  esRuns,
  queuedRuns,
}: {
  esRuns: ScenarioRunData[];
  queuedRuns: ScenarioRunData[];
}): ScenarioRunData[] {
  const storedIds = new Set(esRuns.map((run) => run.scenarioRunId));

  const remainingQueued = queuedRuns.filter((run) => !storedIds.has(run.scenarioRunId));

  return [...esRuns, ...remainingQueued];
}
