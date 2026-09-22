/**
 * The four routes, built.
 *
 * Each turns the shared {@link RouteContext} into the answer the Explorer
 * applies: chips, a phrase, a question to judge with, or a handover to the
 * assistant. A builder that cannot produce its route degrades rather than
 * erroring, and says so on the result: the filter route falls to the phrase
 * search, and the judgement route judges the sentence exactly as typed.
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
  ModelFailure,
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
 * Both are fixed from the model provider settings, which is what the strip
 * under the bar offers when one of them is why a search degraded.
 */
const MODEL_UNAVAILABLE_CODES: readonly string[] = [
  "model_not_configured",
  "model_provider_disabled",
];

/** Which of the two model problems this failure is, and the code it carried. */
export function modelFailureOf(error: unknown): ModelFailure {
  if (!(error instanceof HandledError)) return { modelTrouble: "model_failed" };
  if (MODEL_UNAVAILABLE_CODES.includes(error.code)) {
    return { modelTrouble: "no_model" };
  }
  return { modelTrouble: "model_failed", modelErrorCode: error.code };
}

/**
 * The cause, short enough to sit inside the log message.
 *
 * It goes in the message rather than beside it because the collector that
 * carries these lines ships `msg` and drops the structured fields, so a
 * failure logged only as `err` reaches the operator as "something failed".
 * Everything used here is already curated for a customer-facing disclosure
 * (`summarizeProviderError` extracts a status, a vendor name and a model id
 * and no prose), so nothing the provider wrote travels with it.
 */
export function describeCause(error: unknown): string {
  if (error instanceof HandledError) {
    const meta = error.meta as {
      httpStatus?: unknown;
      provider?: unknown;
      model?: unknown;
    };
    return [
      error.code,
      typeof meta.model === "string" ? meta.model : undefined,
      typeof meta.provider === "string" ? meta.provider : undefined,
      typeof meta.httpStatus === "number"
        ? `HTTP ${meta.httpStatus}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return error instanceof Error ? error.name : "unknown error";
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
  failure,
  fellBackFrom,
}: {
  context: RouteContext;
  decidedBy: SearchRouteDecidedBy;
  failure?: ModelFailure;
  fellBackFrom?: SearchRouteKind | "routing";
}): RouteSearchResult {
  context.deps.recordDecision({ route: "free_text", decidedBy });
  return {
    kind: "free_text",
    query: phraseSearch(context),
    decidedBy,
    ...(fellBackFrom ? { fellBackFrom } : {}),
    ...failure,
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
  failure,
}: {
  context: RouteContext;
  question: { instructions: string; criteria?: [string, string] };
  decidedBy: SearchRouteDecidedBy;
  failure?: ModelFailure;
}): RouteSearchResult {
  context.deps.recordDecision({ route: "instant_eval", decidedBy });
  return {
    kind: "instant_eval",
    question,
    target: context.target,
    otherQuery: context.explicitQuery,
    fallbackQuery: phraseSearch(context),
    decidedBy,
    ...failure,
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
      `Filter route could not be built; searching the phrase instead (${describeCause(error)})`,
    );
    return freeText({
      context,
      decidedBy: "fallback",
      failure: modelFailureOf(error),
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
      `Instant Eval question could not be written; judging the sentence as typed (${describeCause(error)})`,
    );
    // Not the phrase search. The sentence describes a judgement either way,
    // and a judgement of the words as written is the search the reader asked
    // for; matching those words literally is a different search that finds
    // the wrong rows without saying so. This is what a chip typed by hand
    // already does: the question as it stands, no criteria, no model between
    // Enter and the estimate.
    return instantEval({
      context,
      question: { instructions: context.sentence },
      decidedBy: "fallback",
      failure: modelFailureOf(error),
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
