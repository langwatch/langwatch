/**
 * The four routes, built.
 *
 * Each turns the shared {@link RouteContext} into the answer the Explorer
 * applies: chips, a phrase, a question to judge with, or a handover to the
 * assistant. A builder that cannot produce its route falls to the phrase
 * search rather than to an error state, and says what it fell back from.
 *
 * @see ./route-search.ts: which of them runs
 * @see ../../../../../../specs/traces-v2/search.feature
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type {
  AiActionResult,
  InstantEvalQuestionResult,
  InstantEvalSearchTarget,
  KnownProjectSignals,
} from "../ai-query";
import { combineQueries, quoteAsPhrase } from "../query-language/mutations";
import { parse } from "../query-language/parse";
import type {
  RouteAvailability,
  RouteSearchInput,
  RouteSearchResult,
  SearchRouteDecidedBy,
  SearchRouteKind,
  SearchRouterDeps,
} from "./contracts";

const logger = createLogger("langwatch:traces:search-router");

/**
 * The codes model resolution fails with when the project has no model to
 * call: none set at any scope, or one set whose provider is switched off.
 * Both are fixed from the model provider settings, so both get the primer.
 */
const MODEL_UNAVAILABLE_CODES: readonly string[] = [
  "model_not_configured",
  "model_provider_disabled",
];

export function isModelUnavailableError(error: unknown): boolean {
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
export interface RouteContext {
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

export function freeText({
  context,
  decidedBy,
  isModelUnavailable = false,
  fellBackFrom,
}: {
  context: RouteContext;
  decidedBy: SearchRouteDecidedBy;
  isModelUnavailable?: boolean;
  fellBackFrom?: SearchRouteKind | "routing";
}): RouteSearchResult {
  context.deps.recordDecision({ route: "free_text", decidedBy });
  return {
    kind: "free_text",
    query: phraseSearch(context),
    decidedBy,
    isModelUnavailable,
    ...(fellBackFrom ? { fellBackFrom } : {}),
  };
}

export function finishFilter({
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

export function instantEval({
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

export function langy({
  context,
  decidedBy,
}: {
  context: RouteContext;
  decidedBy: SearchRouteDecidedBy;
}): RouteSearchResult {
  context.deps.recordDecision({ route: "langy", decidedBy });
  return { kind: "langy", question: context.input.text, decidedBy };
}

export async function buildFilterRoute({
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
      isModelUnavailable: isModelUnavailableError(error),
      fellBackFrom: "filter",
    });
  }
  return finishFilter({ context, generated: built.query, decidedBy });
}

export async function buildInstantEvalRoute({
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
      isModelUnavailable: isModelUnavailableError(error),
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
