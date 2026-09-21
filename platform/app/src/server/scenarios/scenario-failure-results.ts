/**
 * Builds the terminal `results` envelope for a run that failed for
 * infrastructure reasons rather than a judge verdict.
 *
 * Shared by the two writers of infrastructure failures so they render
 * identically in the drawer: ScenarioFailureHandler (in-process child
 * crashes/timeouts/prefetch errors) and FinishRunCommand (the process
 * manager's stall watchdog and cancel-grace paths, which supply only a
 * bare `error` string on the command).
 */

import { AgentDevTunnelUnreachableError } from "./errors";
import { Verdict } from "./scenario-event.enums";
import {
  classifyScenarioInfraError,
  encodeScenarioError,
  isTransportLevelScenarioFailure,
  ScenarioInfraErrorCode,
} from "./scenario-infra-error";

export interface ScenarioFailureResults {
  verdict: Verdict;
  reasoning: string;
  metCriteria: string[];
  unmetCriteria: string[];
  error: string;
}

export function buildFailureResults(params: {
  cancelled: boolean;
  error?: string;
  /**
   * True when the failed target is an HTTP agent whose config still carries
   * the `devTunnel` marker. Only the failure handler can know this: it reads
   * the agent config, so the other writers leave it unset.
   */
  targetHasDevTunnel?: boolean;
}): ScenarioFailureResults {
  if (params.cancelled) {
    return {
      verdict: Verdict.INCONCLUSIVE,
      reasoning: "Cancelled by user",
      metCriteria: [],
      unmetCriteria: [],
      error: params.error ?? "Cancelled by user",
    };
  }

  // A transport failure on an agent still carrying a `devTunnel` marker is
  // the exact confusion the marker exists to remove: the developer's
  // `langwatch agent dev` session ended without restoring the URL. Name it,
  // rather than reporting a generic unreachable endpoint.
  if (
    params.targetHasDevTunnel &&
    isTransportLevelScenarioFailure(params.error)
  ) {
    const handled = new AgentDevTunnelUnreachableError();
    return {
      verdict: Verdict.FAILURE,
      reasoning: handled.message,
      metCriteria: [],
      unmetCriteria: [],
      error: encodeScenarioError({
        code: ScenarioInfraErrorCode.AgentDevTunnelUnreachable,
        message: handled.message,
        hint: "Run `langwatch agent dev` again on the machine that started the tunnel, or restore the agent's URL in its settings.",
      }),
    };
  }

  // Turn the raw runner failure (often a multi-line child-process dump) into a
  // handled error: a stable code + human message + actionable hint. `reasoning`
  // keeps the plain human sentence for any consumer that reads it as text; the
  // `error` field carries the encoded envelope so the drawer can render a clean,
  // actionable message instead of a stack trace.
  const handled = classifyScenarioInfraError(params.error);
  return {
    verdict: Verdict.FAILURE,
    reasoning: handled.message,
    metCriteria: [],
    unmetCriteria: [],
    error: encodeScenarioError(handled),
  };
}
