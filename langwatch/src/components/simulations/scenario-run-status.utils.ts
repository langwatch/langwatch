import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

/** Returns true when the run is in a non-terminal state that has no results yet. */
export function hasNoResults(status?: ScenarioRunStatus): boolean {
  return (
    status === ScenarioRunStatus.IN_PROGRESS ||
    status === ScenarioRunStatus.PENDING ||
    status === ScenarioRunStatus.STALLED ||
    status === ScenarioRunStatus.CANCELLED
  );
}
