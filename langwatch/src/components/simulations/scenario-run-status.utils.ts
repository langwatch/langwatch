import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

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
 *
 * True only when the run has genuinely finished (terminal status) with zero
 * messages AND did not fail at the infrastructure level — i.e. the agent under
 * test ran but produced nothing. An in-flight run (still streaming) or an
 * errored run (the error is surfaced separately) must NOT show it.
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
