import {
  SimulationRunStatus as ScenarioRunStatus,
  type SimulationRunData,
} from "@langwatch/scenario-contract";

const FAST_INTERVAL_MS = 3000;
const SLOW_INTERVAL_MS = 15000;

<<<<<<< HEAD:modules/suite/web/src/model/get-adaptive-polling-interval.ts
const ACTIVE_STATUSES: ReadonlySet<ScenarioRunStatus> = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.IN_PROGRESS,
  ScenarioRunStatus.PENDING,
  ScenarioRunStatus.QUEUED,
  ScenarioRunStatus.RUNNING,
]);
=======
const ACTIVE_STATUSES: ReadonlySet<ScenarioRunStatus> =
  new Set<ScenarioRunStatus>([
    ScenarioRunStatus.IN_PROGRESS,
    ScenarioRunStatus.PENDING,
    ScenarioRunStatus.QUEUED,
    ScenarioRunStatus.RUNNING,
    // The verdict can still change when the evaluator results land.
    ScenarioRunStatus.PENDING_EVALUATION,
  ]);
>>>>>>> origin/main:platform/app/src/components/suites/getAdaptivePollingInterval.ts

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
  runs: ReadonlyArray<Pick<SimulationRunData, "status">>;
}): number {
  const hasActiveRuns = runs.some((run) => ACTIVE_STATUSES.has(run.status));

  return hasActiveRuns ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
}
