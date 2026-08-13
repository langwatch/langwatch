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
  TEXT_MESSAGE_START = "SCENARIO_TEXT_MESSAGE_START",
  TEXT_MESSAGE_END = "SCENARIO_TEXT_MESSAGE_END",
  TEXT_MESSAGE_CONTENT = "SCENARIO_TEXT_MESSAGE_CONTENT",
  TOOL_CALL_START = "SCENARIO_TOOL_CALL_START",
  TOOL_CALL_ARGS = "SCENARIO_TOOL_CALL_ARGS",
  TOOL_CALL_END = "SCENARIO_TOOL_CALL_END",
}

/**
 * Domain-level statuses persisted in ES/ClickHouse (PENDING, IN_PROGRESS, …).
 * QUEUED is written to ClickHouse via the fold projection when a queueRun
 * command is dispatched. RUNNING maps to a job the queue is executing and
 * remains a UI-only overlay.
 */
export enum ScenarioRunStatus {
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
  CANCELLED = "CANCELLED",
  IN_PROGRESS = "IN_PROGRESS",
  PENDING = "PENDING",
  FAILED = "FAILED",
  /**
   * Kept for external API/UI compatibility and any legacy stored rows.
   * No longer produced anywhere: a stalled run now reaches terminal ERROR
   * (reason "stalled") via the simulationRunExecution process manager's
   * stall watchdog — nothing derives STALLED at read time anymore.
   */
  STALLED = "STALLED",
  /** Queue waiting state - job is queued but not yet picked up by a worker */
  QUEUED = "QUEUED",
  /** Queue active state - job is being executed by a worker */
  RUNNING = "RUNNING",
}

/** Statuses that are eligible for cancellation (still in-flight). */
export const CANCELLABLE_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.QUEUED,
  ScenarioRunStatus.PENDING,
  ScenarioRunStatus.IN_PROGRESS,
]);

/**
 * Determines whether a scenario run with the given status can be cancelled.
 *
 * Only in-flight statuses (QUEUED, PENDING, IN_PROGRESS) are cancellable.
 * Terminal statuses (SUCCESS, FAILED, ERROR, CANCELLED, STALLED) are not.
 *
 * @param status - The current status of the scenario run
 * @returns true if the run is eligible for cancellation
 */
export function isCancellableStatus(status: ScenarioRunStatus): boolean {
  return CANCELLABLE_STATUSES.has(status);
}
