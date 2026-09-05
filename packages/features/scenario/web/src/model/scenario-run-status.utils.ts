import { SimulationRunStatus as ScenarioRunStatus } from "@langwatch/scenario-contract";

const TERMINAL_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
]);

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
