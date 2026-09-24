import { z } from "zod";

/**
 * Where a typed search goes when Enter is pressed on a sentence: a filter the
 * query language can express, a judgement each trace needs, a literal phrase,
 * or a question for the assistant. @see dev/docs/adr/144-trace-search-routes-on-enter.md
 */

export const SEARCH_ROUTE_KINDS = ["filter", "instant_eval", "free_text", "langy"] as const;

export type SearchRouteKind = (typeof SEARCH_ROUTE_KINDS)[number];

/** Who made the call: the classifier, the FAST model, or a fallback rule. */
export const SEARCH_ROUTE_DECIDERS = ["classifier", "model", "fallback"] as const;

export type SearchRouteDecidedBy = (typeof SEARCH_ROUTE_DECIDERS)[number];

/**
 * The model a route needed was missing (`no_model`: none configured) or did
 * not answer (`model_failed`). Both are fixed from the model provider settings.
 */
export const MODEL_TROUBLES = ["no_model", "model_failed"] as const;

export type ModelTrouble = (typeof MODEL_TROUBLES)[number];

/** Which model problem this was, and the handled code it carried, if any. */
export interface ModelFailure {
  modelTrouble: ModelTrouble;
  modelErrorCode?: string;
}

/** Which unit a judgement judges, decided from the lens the search ran in. */
export type InstantEvalSearchTarget = "traces" | "threads" | "llm_spans";

/** What a project already captures, so a question is not asked twice. */
export interface KnownProjectSignals {
  /** Evaluator names with results on the project in the window. */
  evaluators: readonly string[];
  /** Event names seen on the project in the window. */
  events: readonly string[];
}

/**
 * Either a judge question with its yes/no criteria, or a filter the model
 * preferred because an evaluator or event the project already has answers the
 * same sentence.
 */
export type InstantEvalQuestionResult =
  | { kind: "question"; instructions: string; criteria: [string, string] }
  | { kind: "filter"; query: string; reason: string };

export const routeSearchInputSchema = z.object({
  projectId: z.string(),
  /** The whole submitted text: bare words plus any explicit terms. */
  text: z.string().min(1).max(2000),
  timeRange: z.object({ from: z.number(), to: z.number() }),
  /** The query applied before this submit, for context only. */
  activeQuery: z.string().max(2000).default(""),
  /** The lens the search ran in; the Conversations lens judges threads. */
  lensId: z.string().max(200).optional(),
  /** Whether the assistant route is open to this user. Defaults to true. */
  isLangyAvailable: z.boolean().optional(),
});

export type RouteSearchInput = z.infer<typeof routeSearchInputSchema>;

/** Which of the optional routes this submit may be given. */
export interface RouteSearchAvailability {
  isLangyAvailable: boolean;
  /** False while Instant Evals are not released for the project. */
  isInstantEvalAvailable: boolean;
}

const decidedBySchema = z.enum(SEARCH_ROUTE_DECIDERS);

const modelTroubleSchema = z.enum(MODEL_TROUBLES);

export const routeSearchResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("filter"),
    /** The generated query merged with the explicit terms typed. */
    query: z.string(),
    /** Why this filter, when an evaluator or event stood in for a judgement. */
    explanation: z.string().optional(),
    decidedBy: decidedBySchema,
  }),
  z.object({
    kind: z.literal("instant_eval"),
    question: z.object({
      instructions: z.string(),
      /** Yes then no. Absent when no model wrote the question. */
      criteria: z.tuple([z.string(), z.string()]).optional(),
    }),
    target: z.enum(["traces", "threads", "llm_spans"]),
    /** The explicit terms typed alongside the sentence, applied as-is. */
    otherQuery: z.string(),
    /** The phrase search to run instead when the eval does not start. */
    fallbackQuery: z.string(),
    decidedBy: decidedBySchema,
    /** Set when the question is the sentence as typed, because no model rewrote it. */
    modelTrouble: modelTroubleSchema.optional(),
    modelErrorCode: z.string().optional(),
  }),
  z.object({
    kind: z.literal("free_text"),
    /** The sentence as one phrase, merged with the explicit terms. */
    query: z.string(),
    decidedBy: decidedBySchema,
    /** Set when another route was chosen first and could not be built. */
    fellBackFrom: z.enum([...SEARCH_ROUTE_KINDS, "routing"]).optional(),
    /** Set only when a model is what was missing, so the strip offers model settings. */
    modelTrouble: modelTroubleSchema.optional(),
    modelErrorCode: z.string().optional(),
  }),
  z.object({
    kind: z.literal("langy"),
    question: z.string(),
    decidedBy: decidedBySchema,
  }),
]);

export type RouteSearchResult = z.infer<typeof routeSearchResultSchema>;
