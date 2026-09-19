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

/** Who made the call: the classifier, the FAST model, or a fallback rule. */
export type SearchRouteDecidedBy = "classifier" | "model" | "fallback";

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
}: {
  langyAvailable: boolean;
}): InstantEvalCategoryQuestion {
  const options = [
    {
      name: "filter",
      description:
        "The sentence can be written with the trace filter fields listed: a status, a model, a service, a duration, a cost, an evaluator result, an event name, a user or conversation id.",
    },
    {
      name: "instant_eval",
      description:
        "Finding the traces needs reading each one and judging its content (a tone, a language, a promise made, a topic discussed), and no listed evaluator or event already records it.",
    },
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

function isModelUnavailable(error: unknown): boolean {
  return error instanceof HandledError && error.code === "model_not_configured";
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

export function createSearchRouter(deps: SearchRouterDeps): {
  route: (input: RouteSearchInput) => Promise<RouteSearchResult>;
} {
  const phraseSearch = ({
    sentence,
    explicitQuery,
  }: {
    sentence: string;
    explicitQuery: string;
  }): string =>
    combineQueries({ base: explicitQuery, addition: quoteAsPhrase(sentence) });

  const freeText = ({
    sentence,
    explicitQuery,
    decidedBy,
    modelUnavailable = false,
    fellBackFrom,
  }: {
    sentence: string;
    explicitQuery: string;
    decidedBy: SearchRouteDecidedBy;
    modelUnavailable?: boolean;
    fellBackFrom?: SearchRouteKind | "routing";
  }): RouteSearchResult => {
    deps.recordDecision({ route: "free_text", decidedBy });
    return {
      kind: "free_text",
      query: phraseSearch({ sentence, explicitQuery }),
      decidedBy,
      modelUnavailable,
      ...(fellBackFrom ? { fellBackFrom } : {}),
    };
  };

  const buildFilterRoute = async ({
    input,
    sentence,
    explicitQuery,
    decidedBy,
  }: {
    input: RouteSearchInput;
    sentence: string;
    explicitQuery: string;
    decidedBy: SearchRouteDecidedBy;
  }): Promise<RouteSearchResult> => {
    let built: AiActionResult;
    try {
      built = await deps.buildFilter({
        projectId: input.projectId,
        prompt: sentence,
        timeRange: input.timeRange,
      });
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, err: error },
        "Filter route could not be built; searching the phrase instead",
      );
      return freeText({
        sentence,
        explicitQuery,
        decidedBy: "fallback",
        modelUnavailable: isModelUnavailable(error),
        fellBackFrom: "filter",
      });
    }
    return finishFilter({
      generated: built.query,
      sentence,
      explicitQuery,
      decidedBy,
    });
  };

  const finishFilter = ({
    generated,
    sentence,
    explicitQuery,
    decidedBy,
    explanation,
  }: {
    generated: string;
    sentence: string;
    explicitQuery: string;
    decidedBy: SearchRouteDecidedBy;
    explanation?: string;
  }): RouteSearchResult => {
    // The model's own escape hatch for a sentence it could not express.
    if (!generated.trim()) {
      return freeText({
        sentence,
        explicitQuery,
        decidedBy: "fallback",
        fellBackFrom: "filter",
      });
    }
    const merged = combineQueries({ base: explicitQuery, addition: generated });
    const query = parses(merged) ? merged : generated;
    deps.recordDecision({ route: "filter", decidedBy });
    return {
      kind: "filter",
      query,
      decidedBy,
      ...(explanation ? { explanation } : {}),
    };
  };

  const buildInstantEvalRoute = async ({
    input,
    sentence,
    explicitQuery,
    target,
    known,
    decidedBy,
  }: {
    input: RouteSearchInput;
    sentence: string;
    explicitQuery: string;
    target: InstantEvalSearchTarget;
    known: KnownProjectSignals;
    decidedBy: SearchRouteDecidedBy;
  }): Promise<RouteSearchResult> => {
    let built: InstantEvalQuestionResult;
    try {
      built = await deps.buildQuestion({
        projectId: input.projectId,
        text: sentence,
        target,
        known,
      });
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, err: error },
        "Instant Eval question could not be written; searching the phrase instead",
      );
      return freeText({
        sentence,
        explicitQuery,
        decidedBy: "fallback",
        modelUnavailable: isModelUnavailable(error),
        fellBackFrom: "instant_eval",
      });
    }
    if (built.kind === "filter") {
      return finishFilter({
        generated: built.query,
        sentence,
        explicitQuery,
        decidedBy,
        explanation: built.reason,
      });
    }
    deps.recordDecision({ route: "instant_eval", decidedBy });
    return {
      kind: "instant_eval",
      question: { instructions: built.instructions, criteria: built.criteria },
      target,
      otherQuery: explicitQuery,
      fallbackQuery: phraseSearch({ sentence, explicitQuery }),
      decidedBy,
    };
  };

  const classify = async ({
    input,
    sentence,
    explicitQuery,
    known,
    langyAvailable,
  }: {
    input: RouteSearchInput;
    sentence: string;
    explicitQuery: string;
    known: KnownProjectSignals;
    langyAvailable: boolean;
  }): Promise<SearchRouteKind | null> => {
    if (!deps.classifier) return null;
    try {
      const judgement = await deps.classifier.classify({
        projectId: input.projectId,
        text: buildRouteContext({
          sentence,
          explicitQuery,
          activeQuery: input.activeQuery,
          lensId: input.lensId,
          timeRange: input.timeRange,
          known,
        }),
        questions: [buildRouteQuestion({ langyAvailable })],
      });
      const label = judgement.verdicts.find(
        (candidate) => candidate.questionId === ROUTE_QUESTION_ID,
      )?.label;
      if (judgement.skippedReason || !isRouteKind(label)) {
        logger.info(
          {
            projectId: input.projectId,
            skippedReason: judgement.skippedReason,
          },
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
  };

  const route = async (input: RouteSearchInput): Promise<RouteSearchResult> => {
    const langyAvailable = input.langyAvailable ?? true;
    const { sentence, explicitQuery } = splitBareWords(input.text);
    if (!sentence) {
      deps.recordDecision({ route: "filter", decidedBy: "fallback" });
      return { kind: "filter", query: explicitQuery, decidedBy: "fallback" };
    }
    const target: InstantEvalSearchTarget =
      input.lensId === CONVERSATIONS_LENS_ID ? "threads" : "traces";

    let known: KnownProjectSignals = { evaluators: [], events: [] };
    try {
      known = await deps.listKnownSignals({
        projectId: input.projectId,
        timeRange: input.timeRange,
      });
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, err: error },
        "Known evaluators and events could not be listed; routing without them",
      );
    }

    const classified = await classify({
      input,
      sentence,
      explicitQuery,
      known,
      langyAvailable,
    });

    if (classified === "filter") {
      return buildFilterRoute({
        input,
        sentence,
        explicitQuery,
        decidedBy: "classifier",
      });
    }
    if (classified === "instant_eval") {
      return buildInstantEvalRoute({
        input,
        sentence,
        explicitQuery,
        target,
        known,
        decidedBy: "classifier",
      });
    }
    if (classified === "free_text") {
      return freeText({ sentence, explicitQuery, decidedBy: "classifier" });
    }
    if (classified === "langy") {
      deps.recordDecision({ route: "langy", decidedBy: "classifier" });
      return { kind: "langy", question: input.text, decidedBy: "classifier" };
    }

    let decision: SearchRouteDecision;
    try {
      decision = await deps.routeWithModel({
        projectId: input.projectId,
        text: sentence,
        timeRange: input.timeRange,
        target,
        known,
        langyAvailable,
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
        sentence,
        explicitQuery,
        decidedBy: "fallback",
        modelUnavailable,
        fellBackFrom: "routing",
      });
    }

    switch (decision.route) {
      case "filter":
        return finishFilter({
          generated: decision.query,
          sentence,
          explicitQuery,
          decidedBy: "model",
        });
      case "instant_eval":
        deps.recordDecision({ route: "instant_eval", decidedBy: "model" });
        return {
          kind: "instant_eval",
          question: {
            instructions: decision.instructions,
            criteria: decision.criteria,
          },
          target,
          otherQuery: explicitQuery,
          fallbackQuery: phraseSearch({ sentence, explicitQuery }),
          decidedBy: "model",
        };
      case "langy":
        deps.recordDecision({ route: "langy", decidedBy: "model" });
        return { kind: "langy", question: input.text, decidedBy: "model" };
      case "free_text":
        return freeText({ sentence, explicitQuery, decidedBy: "model" });
    }
  };

  return { route };
}
