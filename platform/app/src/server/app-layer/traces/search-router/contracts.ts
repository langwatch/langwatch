/**
 * What a search router is asked, and what it answers.
 *
 * Read without the decisions: every caller of the router and every route
 * builder speaks these types, and only `route-search.ts` decides between
 * them.
 *
 * @see ./route-search.ts: the decision table
 * @see ../../../../../../specs/traces-v2/search.feature
 */

import type { InstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier/classifier";
import type {
  AiActionResult,
  AiQueryInput,
  InstantEvalQuestionInput,
  InstantEvalQuestionResult,
  InstantEvalSearchTarget,
  KnownProjectSignals,
  SearchRouteDecision,
  SearchRouteInput,
} from "../ai-query";

export const SEARCH_ROUTE_KINDS = [
  "filter",
  "instant_eval",
  "free_text",
  "langy",
] as const;

export type SearchRouteKind = (typeof SEARCH_ROUTE_KINDS)[number];

/**
 * Who made the call: the classifier, the FAST model, a fallback rule, or the
 * caller when it already knew the route.
 */
export type SearchRouteDecidedBy =
  | "classifier"
  | "model"
  | "fallback"
  | "caller";

export interface RouteSearchInput {
  projectId: string;
  /** The whole submitted text: bare words plus any explicit terms. */
  text: string;
  timeRange: { from: number; to: number };
  /** The query applied before this submit, for context only. */
  activeQuery: string;
  /** The lens the search ran in; the Conversations lens judges threads. */
  lensId?: string;
  /** Whether the Langy route is open to this user. Defaults to true. */
  isLangyAvailable?: boolean;
  /**
   * The route the caller already knows, which skips the classifier. Set when
   * the text comes from a search that was routed once already, so re-running
   * it cannot land somewhere else: the Explorer re-judges an `eval` chip this
   * way.
   */
  forceKind?: SearchRouteKind;
}

/** Which of the optional routes this submit may be given. */
export interface RouteAvailability {
  isLangyAvailable: boolean;
  /** False while Instant Evals are not released for the project. */
  isInstantEvalAvailable: boolean;
}

export type RouteSearchResult =
  | {
      kind: "filter";
      /** The generated query merged with the explicit terms typed. */
      query: string;
      /** Why this filter, when an evaluator or event stood in for a judgement. */
      explanation?: string;
      decidedBy: SearchRouteDecidedBy;
    }
  | {
      kind: "instant_eval";
      question: {
        instructions: string;
        /** What counts as yes, and what counts as no, in that order. */
        criteria: [string, string];
      };
      target: InstantEvalSearchTarget;
      /** The explicit terms typed alongside the sentence, applied as-is. */
      otherQuery: string;
      /** The phrase search to run instead when the eval does not start. */
      fallbackQuery: string;
      decidedBy: SearchRouteDecidedBy;
    }
  | {
      kind: "free_text";
      /** The sentence as one phrase, merged with the explicit terms. */
      query: string;
      decidedBy: SearchRouteDecidedBy;
      /** No classifier and no model: the client offers to configure one. */
      isModelUnavailable: boolean;
      /** Set when another route was chosen first and could not be built. */
      fellBackFrom?: SearchRouteKind | "routing";
    }
  | {
      kind: "langy";
      question: string;
      decidedBy: SearchRouteDecidedBy;
    };

export interface SearchRouterDeps {
  /** The classifier, or null when the deployment has none. */
  classifier: Pick<InstantEvalClassifier, "classify"> | null;
  /** Builds a filter from a sentence (the Ask AI composer's own builder). */
  buildFilter: (input: AiQueryInput) => Promise<AiActionResult>;
  /** Rewrites a sentence into a judge question, or an existing-signal filter. */
  buildQuestion: (
    input: InstantEvalQuestionInput,
  ) => Promise<InstantEvalQuestionResult>;
  /** Decides and builds in one model call, when there is no classifier. */
  routeWithModel: (input: SearchRouteInput) => Promise<SearchRouteDecision>;
  /** Evaluator and event names on the project, for the context line. */
  listKnownSignals: (input: {
    projectId: string;
    timeRange: { from: number; to: number };
  }) => Promise<KnownProjectSignals>;
  /** Whether Instant Evals are released for the project (the flag alone). */
  isInstantEvalReleased: (input: { projectId: string }) => Promise<boolean>;
  /** Counts a decision. Never metered. */
  recordDecision: (decision: {
    route: SearchRouteKind;
    decidedBy: SearchRouteDecidedBy;
  }) => void;
}
