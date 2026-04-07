import { ScenarioRunStatus } from "./scenario-event.enums";

/**
 * Threshold in milliseconds after which a run without RUN_FINISHED
 * is considered stalled. Set to 10 minutes (2x the 5-minute job timeout)
 * to cover all reasonable completion scenarios.
 */
export const STALL_THRESHOLD_MS = 10 * 60 * 1000;

/** Statuses that represent a completed run (no further work expected). */
const TERMINAL_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.CANCELLED,
]);

/**
 * Resolves the effective status of a scenario run, deriving STALLED
 * at read time when a run has no RUN_FINISHED event and enough time
 * has passed since the last event.
 *
 * This is a pure function with no side effects -- it does not write
 * any new events to ElasticSearch.
 *
 * @param params.finishedStatus - The status from RUN_FINISHED event, or undefined if none exists
 * @param params.storedStatus - The persisted status from ClickHouse/ES (optional). When this
 *   is a terminal status (SUCCESS, FAILED, ERROR, CANCELLED) it takes precedence over stall
 *   detection, preventing completed runs from being retroactively marked as STALLED when the
 *   completion event (which sets FinishedAt) failed to persist.
 * @param params.lastEventTimestamp - Timestamp (ms) of the most recent event of any type
 * @param params.now - Current time in ms (injectable for testing)
 * @returns The resolved ScenarioRunStatus
 */
export function resolveRunStatus({
  finishedStatus,
  storedStatus,
  lastEventTimestamp,
  now = Date.now(),
}: {
  finishedStatus: ScenarioRunStatus | undefined;
  storedStatus?: ScenarioRunStatus;
  lastEventTimestamp: number;
  now?: number;
}): ScenarioRunStatus {
  // If a RUN_FINISHED event exists, use its status as-is
  if (finishedStatus !== undefined) {
    return finishedStatus;
  }

  // If the stored status is already terminal, trust it even without a
  // RUN_FINISHED event. This handles the case where the completion event
  // dispatch to ClickHouse failed but the status was set correctly.
  if (storedStatus !== undefined && TERMINAL_STATUSES.has(storedStatus)) {
    return storedStatus;
  }

  // No RUN_FINISHED: check if the run has stalled
  const elapsed = now - lastEventTimestamp;
  if (elapsed >= STALL_THRESHOLD_MS) {
    return ScenarioRunStatus.STALLED;
  }

  return ScenarioRunStatus.IN_PROGRESS;
}
