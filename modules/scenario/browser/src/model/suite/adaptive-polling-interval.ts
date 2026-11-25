/**
 * How often the run history asks the freshness probe while the live stream is down.
 * @see specs/features/suites/real-time-run-updates.feature
 */

import { categorizeRunStatus, type ScenarioRunData } from "@langwatch/scenario-contract";

export const FAST_POLLING_INTERVAL_MS = 3_000;
export const SLOW_POLLING_INTERVAL_MS = 15_000;

/** Fast while any run can still change (queued, running, evaluating), slow once all settled. */
export function getAdaptivePollingInterval({
  runs,
}: {
  runs: readonly Pick<ScenarioRunData, "status">[];
}): number {
  const hasActiveRun = runs.some((run) => {
    const category = categorizeRunStatus(run.status);
    return category === "in_progress" || category === "queued";
  });
  return hasActiveRun ? FAST_POLLING_INTERVAL_MS : SLOW_POLLING_INTERVAL_MS;
}
