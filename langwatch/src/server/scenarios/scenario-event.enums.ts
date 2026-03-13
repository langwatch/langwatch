/**
 * Verdict enum represents the possible outcomes of a test scenario
 */
export enum Verdict {
  SUCCESS = "success",
  FAILURE = "failure",
  INCONCLUSIVE = "inconclusive",
}

// Scenario event type enum
export enum ScenarioEventType {
  RUN_STARTED = "SCENARIO_RUN_STARTED",
  RUN_FINISHED = "SCENARIO_RUN_FINISHED",
  MESSAGE_SNAPSHOT = "SCENARIO_MESSAGE_SNAPSHOT",
}

export enum ScenarioRunStatus {
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
  CANCELLED = "CANCELLED",
  IN_PROGRESS = "IN_PROGRESS",
  PENDING = "PENDING",
  FAILED = "FAILED",
  STALLED = "STALLED",
  /** BullMQ waiting state - job is queued but not yet picked up by a worker */
  QUEUED = "QUEUED",
  /** BullMQ active state - job is being executed by a worker */
  RUNNING = "RUNNING",
}

/** Statuses that are eligible for cancellation (still in-flight). */
export const CANCELLABLE_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.PENDING,
  ScenarioRunStatus.IN_PROGRESS,
  ScenarioRunStatus.STALLED,
]);

/**
 * Determines whether a scenario run with the given status can be cancelled.
 *
 * Only in-flight statuses (PENDING, IN_PROGRESS, STALLED) are cancellable.
 * Terminal statuses (SUCCESS, FAILED, ERROR, CANCELLED) are not.
 *
 * @param status - The current status of the scenario run
 * @returns true if the run is eligible for cancellation
 */
export function isCancellableStatus(status: ScenarioRunStatus): boolean {
  return CANCELLABLE_STATUSES.has(status);
}
