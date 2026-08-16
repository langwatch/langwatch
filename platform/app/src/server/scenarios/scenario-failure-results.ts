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

import { Verdict } from "./scenario-event.enums";
import {
  classifyScenarioInfraError,
  encodeScenarioError,
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
