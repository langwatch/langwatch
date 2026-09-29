import {
  isSimulationRunFinishedEvent,
  UNGRADED_RUN_STATUSES,
  type SimulationProcessingEvent,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";

/**
 * A run that worked against a connected agent: it finished with a verdict,
 * whichever way the judge decided. An ungraded status (error, unreachable
 * target, timeout) is not one. Pure, so the subscriber can ask it early.
 */
export function isConnectedAgentRunSucceeded(
  event: SimulationProcessingEvent,
): event is SimulationRunFinishedEvent {
  if (!isSimulationRunFinishedEvent(event)) return false;
  const { target, status, results } = event.data;
  if (target?.type !== "connected") return false;
  const explicit = status?.toUpperCase();
  if (explicit && UNGRADED_RUN_STATUSES.has(explicit)) return false;
  if (explicit === "SUCCESS" || explicit === "FAILED" || explicit === "FAILURE") return true;
  return results?.verdict === "success" || results?.verdict === "failure";
}
