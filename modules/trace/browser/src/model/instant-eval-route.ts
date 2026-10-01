import type { InstantEvalSearchTarget, ModelTrouble } from "@langwatch/trace-contract";

/**
 * What the router hands over when Enter on a sentence is a judgement each
 * trace needs: the question, the unit judged, the terms typed beside it and
 * the phrase search to fall back to. @see ADR-144
 */
export interface InstantEvalRoutePayload {
  projectId: string;
  /** The sentence as typed, bare words only. */
  sentence: string;
  question: {
    instructions: string;
    /**
     * What counts as yes, and what counts as no, in that order. Written by the
     * classifier for a routed sentence; absent for a question typed as a chip,
     * which the judge reads as it is.
     */
    criteria?: [string, string];
  };
  target: InstantEvalSearchTarget;
  /** The explicit `field:value` terms typed alongside the sentence. */
  otherQuery: string;
  /** The sentence quoted as one phrase, merged with `otherQuery`. */
  fallbackQuery: string;
  timeRange: { from: number; to: number };
  /** Set when the question is the sentence as typed because no model rewrote it. */
  modelTrouble?: ModelTrouble;
  /** The handled code of that failure, when it carried one. */
  modelErrorCode?: string;
}
