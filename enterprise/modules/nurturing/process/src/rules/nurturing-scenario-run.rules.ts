// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type SimulationRunFinishedEventData,
  UNGRADED_RUN_STATUSES,
} from "@langwatch/scenario-contract";

/**
 * A run that worked against a connected agent: it finished with a verdict,
 * whichever way the judge decided. An ungraded status (error, unreachable
 * target, timeout) is not one.
 */
export function isConnectedAgentRunSucceeded(data: SimulationRunFinishedEventData): boolean {
  const { target, status, results } = data;
  if (target?.type !== "connected") return false;
  const explicit = status?.toUpperCase();
  if (explicit && UNGRADED_RUN_STATUSES.has(explicit)) return false;
  if (explicit === "SUCCESS" || explicit === "FAILED" || explicit === "FAILURE") return true;
  return results?.verdict === "success" || results?.verdict === "failure";
}
