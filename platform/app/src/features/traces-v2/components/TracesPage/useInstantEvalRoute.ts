import { useCallback } from "react";
import type { InstantEvalSearchTarget } from "~/server/app-layer/traces/ai-query";
import { useFilterStore } from "../../stores/filterStore";

/**
 * What the search router hands over when Enter on a sentence is a judgement
 * each trace needs. Everything the Explorer needs to start the run is here:
 * the question as the judge will read it, the unit it judges (from the lens
 * the search ran in), the explicit terms typed next to the sentence, and the
 * phrase search to fall back to when the run does not start.
 */
export interface InstantEvalRoutePayload {
  projectId: string;
  /** The sentence as typed, bare words only. */
  sentence: string;
  question: {
    instructions: string;
    /** What counts as yes, and what counts as no, in that order. */
    criteria: [string, string];
  };
  target: InstantEvalSearchTarget;
  /** The explicit `field:value` terms typed alongside the sentence. */
  otherQuery: string;
  /** The sentence quoted as one phrase, merged with `otherQuery`. */
  fallbackQuery: string;
  timeRange: { from: number; to: number };
}

/**
 * The Explorer's handler for the `instant_eval` route.
 *
 * The full handler (an `eval:"question"` chip, the cost rule, the progress
 * bar over the table) is the next part of this feature and is specified as
 * pending in specs/traces-v2/search.feature ("An Instant Eval route starts a
 * run"). Until it lands, the route applies the phrase search the router
 * built, so Enter on such a sentence still searches something visible.
 */
export function useInstantEvalRoute(): {
  onInstantEvalRoute: (payload: InstantEvalRoutePayload) => void;
} {
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const onInstantEvalRoute = useCallback(
    (payload: InstantEvalRoutePayload) => {
      applyQueryText(payload.fallbackQuery);
    },
    [applyQueryText],
  );
  return { onInstantEvalRoute };
}
