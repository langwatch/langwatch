/**
 * A checked Instant Eval run as the Explorer's filter compiler binds it. Pure;
 * the peer call itself is the service's.
 */
import type { InstantEvalRunWindow } from "@langwatch/instant-eval-contract";
import type { ResolvedInstantEvalRun } from "@langwatch/trace-contract";

/** A checked run as the filter compiler binds it: its window in epoch milliseconds. */
export function toResolvedInstantEvalRun(window: InstantEvalRunWindow): ResolvedInstantEvalRun {
  return {
    question: window.question,
    target: window.target,
    runId: window.runId,
    writtenFrom: window.writtenFrom.epochMilliseconds,
    writtenUntil: window.writtenUntil.epochMilliseconds,
  };
}
