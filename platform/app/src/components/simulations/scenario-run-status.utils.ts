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
