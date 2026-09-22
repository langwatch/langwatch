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
 * Every dependency arrives through `SearchRouterDeps` so the decision table is
 * unit-tested with a stub classifier and stub builders; the production wiring
 * lives in `./index.ts`. The contracts are in `./contracts.ts`, what the
 * classifier is asked in `./classifier-context.ts`, and the routes themselves
 * in `./routes.ts`.
 *
 * @see specs/traces-v2/search.feature ("Enter routes a sentence")
 * @see dev/docs/adr/139-trace-search-routes-on-enter.md
 */

import { createLogger } from "@langwatch/observability";

import type { KnownProjectSignals, SearchRouteDecision } from "../ai-query";
import { splitBareWords } from "../query-language/mutations";
import {
  buildRouteContext,
  buildRouteQuestion,
  CONVERSATIONS_LENS_ID,
  isRouteKind,
  ROUTE_QUESTION_ID,
} from "./classifier-context";
import type {
  RouteSearchInput,
  RouteSearchResult,
  SearchRouteDecidedBy,
  SearchRouteKind,
  SearchRouterDeps,
} from "./contracts";
import {
  buildFilterRoute,
  buildInstantEvalRoute,
  describeCause,
  finishFilter,
  freeText,
  instantEval,
  langy,
  modelFailureOf,
  type RouteContext,
} from "./routes";

const logger = createLogger("langwatch:traces:search-router");

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
      return context.available.isInstantEvalAvailable
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
    const failure = modelFailureOf(error);
    if (failure.modelTrouble === "model_failed") {
      logger.warn(
        { projectId: input.projectId, err: error },
        `Model could not route the search; searching the phrase instead (${describeCause(error)})`,
      );
    }
    return freeText({
      context,
      decidedBy: "fallback",
      failure,
      fellBackFrom: "routing",
    });
  }
  const decidedBy = "model";
  switch (decision.route) {
    case "filter":
      return finishFilter({ context, generated: decision.query, decidedBy });
    case "instant_eval":
      if (!context.available.isInstantEvalAvailable) {
        // A guard, not a path: the model is told the route is closed and the
        // decision reader downgrades an answer naming it anyway, so this only
        // catches a `routeWithModel` that does neither. The phrase is what
        // the model settled on once the closed route is taken off the table,
        // and nothing about the project's models is wrong, so no strip and
        // no model trouble.
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
  const [known, isInstantEvalAvailable] = await Promise.all([
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
      isLangyAvailable: input.isLangyAvailable ?? true,
      isInstantEvalAvailable,
    },
  };
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
