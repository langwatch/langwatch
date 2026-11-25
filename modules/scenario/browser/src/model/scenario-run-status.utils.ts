import { SimulationRunStatus as ScenarioRunStatus } from "@langwatch/scenario-contract";

const TERMINAL_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
  // The conversation is over and the judge has spoken, so the drawer has a
  // verdict and criteria to draw. The status chip beside them says the
  // evaluators are still to come.
  ScenarioRunStatus.PENDING_EVALUATION,
]);

/** Statuses whose record is final: nothing more streams into the run. */
const FINISHED_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.CANCELLED,
]);

/** A stalled run is not finished: it revives when new events arrive. */
export function isFinishedRunStatus(status: ScenarioRunStatus | undefined): boolean {
  return status !== void 0 && FINISHED_STATUSES.has(status);
}

/** Returns true when the run has no displayable results (non-terminal or unknown status). */
export function hasNoResults(status?: ScenarioRunStatus): boolean {
  return status === undefined || !TERMINAL_STATUSES.has(status);
}

/**
 * Whether the drawer should show an explicit "No response" empty state for the
 * conversation.
 */
export function shouldShowNoResponse(params: {
  status?: ScenarioRunStatus;
  hasConversation: boolean;
  hasError: boolean;
}): boolean {
  const { status, hasConversation, hasError } = params;
  if (hasConversation || hasError) return false;
  return !hasNoResults(status);
}
