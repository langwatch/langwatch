import {
  SimulationRunStatus as ScenarioRunStatus,
  type SimulationRunData,
} from "@langwatch/scenario-contract";

const FAST_INTERVAL_MS = 3000;
const SLOW_INTERVAL_MS = 15000;

const ACTIVE_STATUSES: ReadonlySet<ScenarioRunStatus> = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.IN_PROGRESS,
  ScenarioRunStatus.PENDING,
  ScenarioRunStatus.QUEUED,
  ScenarioRunStatus.RUNNING,
  // The verdict can still change when the evaluator results land.
  ScenarioRunStatus.PENDING_EVALUATION,
]);

// Adaptive polling interval: fast when active, slow when settled.
export function getAdaptivePollingInterval({
  runs,
}: {
  runs: readonly Pick<SimulationRunData, "status">[];
}): number {
  const hasActiveRuns = runs.some((run) => ACTIVE_STATUSES.has(run.status));

  return hasActiveRuns ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
}
