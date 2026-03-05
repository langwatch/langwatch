import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

const FAST_INTERVAL_MS = 3000;
const SLOW_INTERVAL_MS = 15000;

const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  ScenarioRunStatus.IN_PROGRESS,
  ScenarioRunStatus.PENDING,
]);

/**
 * Computes an adaptive polling interval based on run statuses.
 *
 * Returns a fast interval (2-3s) when any run is PENDING or IN_PROGRESS,
 * and a slow interval (15-30s) when all runs are settled.
 *
 * @param options.runs - Array of scenario run data to inspect
 * @returns Polling interval in milliseconds
 */
export function getAdaptivePollingInterval({
  runs,
}: {
  runs: ReadonlyArray<Pick<ScenarioRunData, "status">>;
}): number {
  const hasActiveRuns = runs.some((run) => ACTIVE_STATUSES.has(run.status));

  return hasActiveRuns ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
}
