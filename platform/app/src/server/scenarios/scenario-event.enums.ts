export {
  SimulationVerdict as Verdict,
  SimulationRunStatus as ScenarioRunStatus,
} from "@langwatch/simulation-contract";

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

/** Statuses a run cannot move out of. */
export const TERMINAL_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.CANCELLED,
  ScenarioRunStatus.STALLED,
]);

/**
 * Whether a run has reached a state it will never leave.
 *
 * Not the negation of `isCancellableStatus`: RUNNING is neither cancellable
 * (it has no queued job to drop) nor terminal, so the two sets do not
 * partition the enum between them.
 */
export function isTerminalStatus(status: ScenarioRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
