/**
 * Where a typed search goes when Enter is pressed on a sentence.
 *
 * A search with only `field:value` terms is applied as typed and never gets
 * here. A search with bare words is a sentence, and a sentence is one of four
 * things: a filter the query language can express, a judgement each trace
 * needs (an Instant Eval), a literal phrase to match, or a question for Langy.
 * The classifier decides which, in one category question over the sentence
 * and a line of context; a deployment without the classifier asks the FAST
 * model to both decide and build; a deployment with neither searches the
 * phrase and says why.
 *
 * Routing is counted, not metered: one question of a few hundred tokens per
 * Enter is below the noise floor of the spend spine, so it lands on a metric
 * and no spend record (ADR-139).
 *
 * Every dependency arrives through {@link SearchRouterDeps} so the decision
 * table is unit-tested with a stub classifier and stub builders; the
 * production wiring lives in `./index.ts`.
 *
 * @see specs/traces-v2/search.feature ("Enter routes a sentence")
 * @see dev/docs/adr/139-trace-search-routes-on-enter.md
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type {
  InstantEvalCategoryQuestion,
  InstantEvalClassifier,
} from "~/server/app-layer/instant-evals/classifier/classifier";
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
import { SEARCH_FIELDS } from "../query-language/metadata";
import {
  combineQueries,
  quoteAsPhrase,
  splitBareWords,
} from "../query-language/mutations";
import { parse } from "../query-language/parse";

const logger = createLogger("langwatch:traces:search-router");

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
  langyAvailable?: boolean;
  /**
   * The route the caller already knows, which skips the classifier. Set when
   * the text comes from a search that was routed once already, so re-running
   * it cannot land somewhere else: the Explorer re-judges an `eval` chip this
   * way.
   */
  forceKind?: SearchRouteKind;
}

/** Which of the optional routes this submit may be given. */
interface RouteAvailability {
  langyAvailable: boolean;
  /** False while Instant Evals are not released for the project. */
  instantEvalAvailable: boolean;
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
      modelUnavailable: boolean;
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

/** The lens whose rows are conversations, so its eval judges threads. */
const CONVERSATIONS_LENS_ID = "conversations";

const ROUTE_QUESTION_ID = "route";

/** How the classifier is asked. Exported so the prompt is pinned by a test. */
export function buildRouteQuestion({
  langyAvailable,
  instantEvalAvailable = true,
}: Pick<RouteAvailability, "langyAvailable"> &
  Partial<
    Pick<RouteAvailability, "instantEvalAvailable">
  >): InstantEvalCategoryQuestion {
  const options = [
    {
      name: "filter",
      description:
        "The sentence can be written with the trace filter fields listed: a status, a model, a service, a duration, a cost, an evaluator result, an event name, a user or conversation id.",
    },
    ...(instantEvalAvailable
      ? [
          {
            name: "instant_eval",
            description:
              "Finding the traces needs reading each one and judging its content (a tone, a language, a promise made, a topic discussed), and no listed evaluator or event already records it.",
          },
        ]
      : []),
    {
      name: "free_text",
      description:
        "The sentence is a literal string to look for in the traces: an id, an error message, a product name, a quoted phrase.",
    },
    ...(langyAvailable
      ? [
          {
            name: "langy",
            description:
              "The sentence asks for reasoning over many traces, a comparison, a cause, a summary, or data the filters cannot reach. It is a question for the assistant, not a search.",
          },
        ]
      : []),
  ];
  return {
    id: ROUTE_QUESTION_ID,
    kind: "category",
    instructions:
      "An operator typed this sentence into the search bar of a list of LLM traces. Which kind of search is it?",
    options,
  };
}

/** The sentence with the context the classifier reads next to it. */
export function buildRouteContext({
  sentence,
  explicitQuery,
  activeQuery,
  lensId,
  timeRange,
  known,
}: {
  sentence: string;
  explicitQuery: string;
  activeQuery: string;
  lensId?: string;
  timeRange: { from: number; to: number };
  known: KnownProjectSignals;
}): string {
  const hours = Math.max(
    1,
    Math.round((timeRange.to - timeRange.from) / 3_600_000),
  );
  const fields = Object.keys(SEARCH_FIELDS).join(", ");
  return [
    `Typed sentence: ${sentence}`,
    `Lens: ${lensId ?? "all traces"}. Time window: ${hours} hours.`,
    explicitQuery ? `Typed alongside it as filters: ${explicitQuery}` : null,
    activeQuery ? `Search applied before this one: ${activeQuery}` : null,
    `Filter fields available: ${fields}`,
    `Evaluators with results on this project: ${
      known.evaluators.length > 0 ? known.evaluators.join(", ") : "none"
    }`,
    `Event names on this project: ${
      known.events.length > 0 ? known.events.join(", ") : "none"
    }`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function isRouteKind(value: unknown): value is SearchRouteKind {
  return (
    typeof value === "string" &&
    (SEARCH_ROUTE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The codes model resolution fails with when the project has no model to
 * call: none set at any scope, or one set whose provider is switched off.
 * Both are fixed from the model provider settings, so both get the primer.
 */
const MODEL_UNAVAILABLE_CODES: readonly string[] = [
  "model_not_configured",
  "model_provider_disabled",
];

function isModelUnavailable(error: unknown): boolean {
  return (
    error instanceof HandledError &&
    MODEL_UNAVAILABLE_CODES.includes(error.code)
  );
}

/** A query the language parses, or null when it does not. */
function parses(query: string): boolean {
  try {
    parse(query);
    return true;
  } catch {
    return false;
  }
}

/** The sentence and the explicit terms as one shared context for the routes. */
interface RouteContext {
  deps: SearchRouterDeps;
  input: RouteSearchInput;
  sentence: string;
  explicitQuery: string;
  target: InstantEvalSearchTarget;
  known: KnownProjectSignals;
  available: RouteAvailability;
}

function phraseSearch({
  sentence,
  explicitQuery,
}: {
  sentence: string;
  explicitQuery: string;
}): string {
  return combineQueries({
    base: explicitQuery,
    addition: quoteAsPhrase(sentence),
  });
}

function freeText({
  context,
  decidedBy,
  modelUnavailable = false,
  fellBackFrom,
}: {
  context: RouteContext;
  decidedBy: SearchRouteDecidedBy;
  modelUnavailable?: boolean;
  fellBackFrom?: SearchRouteKind | "routing";
}): RouteSearchResult {
  context.deps.recordDecision({ route: "free_text", decidedBy });
  return {
    kind: "free_text",
    query: phraseSearch(context),
    decidedBy,
    modelUnavailable,
    ...(fellBackFrom ? { fellBackFrom } : {}),
  };
}

function finishFilter({
  context,
  generated,
  decidedBy,
  explanation,
}: {
  context: RouteContext;
  generated: string;
  decidedBy: SearchRouteDecidedBy;
  explanation?: string;
}): RouteSearchResult {
  // The model's own escape hatch for a sentence it could not express.
  if (!generated.trim()) {
    return freeText({ context, decidedBy: "fallback", fellBackFrom: "filter" });
  }
  const merged = combineQueries({
    base: context.explicitQuery,
    addition: generated,
  });
  const query = parses(merged) ? merged : generated;
  context.deps.recordDecision({ route: "filter", decidedBy });
  return {
    kind: "filter",
    query,
    decidedBy,
    ...(explanation ? { explanation } : {}),
  };
}

function instantEval({
  context,
  question,
  decidedBy,
}: {
  context: RouteContext;
  question: { instructions: string; criteria: [string, string] };
  decidedBy: SearchRouteDecidedBy;
}): RouteSearchResult {
  context.deps.recordDecision({ route: "instant_eval", decidedBy });
  return {
    kind: "instant_eval",
    question,
    target: context.target,
    otherQuery: context.explicitQuery,
    fallbackQuery: phraseSearch(context),
    decidedBy,
  };
}

function langy({
  context,
  decidedBy,
}: {
  context: RouteContext;
  decidedBy: SearchRouteDecidedBy;
}): RouteSearchResult {
  context.deps.recordDecision({ route: "langy", decidedBy });
  return { kind: "langy", question: context.input.text, decidedBy };
}

async function buildFilterRoute({
  context,
  decidedBy,
}: {
  context: RouteContext;
  decidedBy: SearchRouteDecidedBy;
}): Promise<RouteSearchResult> {
  let built: AiActionResult;
  try {
    built = await context.deps.buildFilter({
      projectId: context.input.projectId,
      prompt: context.sentence,
      timeRange: context.input.timeRange,
    });
  } catch (error) {
    logger.warn(
      { projectId: context.input.projectId, err: error },
      "Filter route could not be built; searching the phrase instead",
    );
    return freeText({
      context,
      decidedBy: "fallback",
      modelUnavailable: isModelUnavailable(error),
      fellBackFrom: "filter",
    });
  }
  return finishFilter({ context, generated: built.query, decidedBy });
}

async function buildInstantEvalRoute({
  context,
  decidedBy,
}: {
  context: RouteContext;
  decidedBy: SearchRouteDecidedBy;
}): Promise<RouteSearchResult> {
  let built: InstantEvalQuestionResult;
  try {
    built = await context.deps.buildQuestion({
      projectId: context.input.projectId,
      text: context.sentence,
      target: context.target,
      known: context.known,
    });
  } catch (error) {
    logger.warn(
      { projectId: context.input.projectId, err: error },
      "Instant Eval question could not be written; searching the phrase instead",
    );
    return freeText({
      context,
      decidedBy: "fallback",
      modelUnavailable: isModelUnavailable(error),
      fellBackFrom: "instant_eval",
    });
  }
  if (built.kind === "filter") {
    return finishFilter({
      context,
      generated: built.query,
      decidedBy,
      explanation: built.reason,
    });
  }
  return instantEval({
    context,
    question: { instructions: built.instructions, criteria: built.criteria },
    decidedBy,
  });
}

/** The classifier's answer, or null when it had none and the model decides. */
async function classify(
  context: RouteContext,
): Promise<SearchRouteKind | null> {
  const { deps, input } = context;
  if (!deps.classifier) return null;
  try {
    const judgement = await deps.classifier.classify({
      projectId: input.projectId,
      text: buildRouteContext({
        sentence: context.sentence,
        explicitQuery: context.explicitQuery,
        activeQuery: input.activeQuery,
        lensId: input.lensId,
        timeRange: input.timeRange,
        known: context.known,
      }),
      questions: [buildRouteQuestion(context.available)],
    });
    const label = judgement.verdicts.find(
      (candidate) => candidate.questionId === ROUTE_QUESTION_ID,
    )?.label;
    if (judgement.skippedReason || !isRouteKind(label)) {
      logger.info(
        { projectId: input.projectId, skippedReason: judgement.skippedReason },
        "Classifier did not route the search; the model decides",
      );
      return null;
    }
    return label;
  } catch (error) {
    logger.warn(
      { projectId: input.projectId, err: error },
      "Classifier failed to route the search; the model decides",
    );
    return null;
  }
}

async function applyClassified({
  context,
  classified,
  decidedBy,
}: {
  context: RouteContext;
  classified: SearchRouteKind;
  decidedBy: SearchRouteDecidedBy;
}): Promise<RouteSearchResult> {
  switch (classified) {
    case "filter":
      return buildFilterRoute({ context, decidedBy });
    case "instant_eval":
      // The option is not offered while Instant Evals are unreleased; an
      // answer naming it anyway is searched as a filter, which falls to the
      // phrase on its own when the model cannot write one.
      return context.available.instantEvalAvailable
        ? buildInstantEvalRoute({ context, decidedBy })
        : buildFilterRoute({ context, decidedBy });
    case "free_text":
      return freeText({ context, decidedBy });
    case "langy":
      return langy({ context, decidedBy });
  }
}

/** The model both decides and builds when the classifier had no answer. */
async function routeWithModel(
  context: RouteContext,
): Promise<RouteSearchResult> {
  const { deps, input } = context;
  let decision: SearchRouteDecision;
  try {
    decision = await deps.routeWithModel({
      projectId: input.projectId,
      text: context.sentence,
      timeRange: input.timeRange,
      target: context.target,
      known: context.known,
      ...context.available,
    });
  } catch (error) {
    const modelUnavailable = isModelUnavailable(error);
    if (!modelUnavailable) {
      logger.warn(
        { projectId: input.projectId, err: error },
        "Model could not route the search; searching the phrase instead",
      );
    }
    return freeText({
      context,
      decidedBy: "fallback",
      modelUnavailable,
      fellBackFrom: "routing",
    });
  }
  const decidedBy = "model";
  switch (decision.route) {
    case "filter":
      return finishFilter({ context, generated: decision.query, decidedBy });
    case "instant_eval":
      if (!context.available.instantEvalAvailable) {
        return freeText({ context, decidedBy });
      }
      return instantEval({
        context,
        question: {
          instructions: decision.instructions,
          criteria: decision.criteria,
        },
        decidedBy,
      });
    case "langy":
      return langy({ context, decidedBy });
    case "free_text":
      return freeText({ context, decidedBy });
  }
}

/** The flag read, failing closed: an unreadable flag offers no judgement. */
async function isInstantEvalReleased({
  deps,
  input,
}: {
  deps: SearchRouterDeps;
  input: RouteSearchInput;
}): Promise<boolean> {
  try {
    return await deps.isInstantEvalReleased({ projectId: input.projectId });
  } catch (error) {
    logger.warn(
      { projectId: input.projectId, err: error },
      "Instant Evals release could not be read; routing without the judgement route",
    );
    return false;
  }
}

async function listKnownSignals({
  deps,
  input,
}: {
  deps: SearchRouterDeps;
  input: RouteSearchInput;
}): Promise<KnownProjectSignals> {
  try {
    return await deps.listKnownSignals({
      projectId: input.projectId,
      timeRange: input.timeRange,
    });
  } catch (error) {
    logger.warn(
      { projectId: input.projectId, err: error },
      "Known evaluators and events could not be listed; routing without them",
    );
    return { evaluators: [], events: [] };
  }
}

async function routeSearch({
  deps,
  input,
}: {
  deps: SearchRouterDeps;
  input: RouteSearchInput;
}): Promise<RouteSearchResult> {
  const { sentence, explicitQuery } = splitBareWords(input.text);
  if (!sentence) {
    deps.recordDecision({ route: "filter", decidedBy: "fallback" });
    return { kind: "filter", query: explicitQuery, decidedBy: "fallback" };
  }
  const [known, instantEvalAvailable] = await Promise.all([
    listKnownSignals({ deps, input }),
    isInstantEvalReleased({ deps, input }),
  ]);
  const context: RouteContext = {
    deps,
    input,
    sentence,
    explicitQuery,
    target: input.lensId === CONVERSATIONS_LENS_ID ? "threads" : "traces",
    known,
    available: {
      langyAvailable: input.langyAvailable ?? true,
      instantEvalAvailable,
    },
  };
  if (input.forceKind) {
    return applyClassified({
      context,
      classified: input.forceKind,
      decidedBy: "caller",
    });
  }
  const classified = await classify(context);
  if (classified) {
    return applyClassified({ context, classified, decidedBy: "classifier" });
  }
  return routeWithModel(context);
}

export function createSearchRouter(deps: SearchRouterDeps): {
  route: (input: RouteSearchInput) => Promise<RouteSearchResult>;
} {
  return { route: (input) => routeSearch({ deps, input }) };
}
