/**
 * What the routing classifier is asked, and the context it reads a search-bar
 * sentence next to. Pinned by tests: a change here changes every routing
 * decision the search bar makes. Copied from trace's router (T2 D3). @see ADR-144
 */

import type {
  InstantEvalCategoryQuestion,
  InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";
import { SEARCH_FIELDS, type KnownProjectSignals } from "@langwatch/trace-contract";

const ROUTE_QUESTION_ID = "route";

/** Evaluator and event names read per facet for the context line. */
export const KNOWN_SIGNALS_LIMIT = 20;

/** How the classifier is asked. Langy and Instant Eval are offered only when open. */
export function buildRouteQuestion({
  isLangyAvailable,
  isInstantEvalAvailable,
}: {
  isLangyAvailable: boolean;
  isInstantEvalAvailable: boolean;
}): InstantEvalCategoryQuestion {
  const options = [
    {
      name: "filter",
      description:
        "The sentence can be written with the trace filter fields listed: a status, a model, a service, a duration, a cost, an evaluator result, an event name, a user or conversation id.",
    },
    ...(isInstantEvalAvailable
      ? [
          {
            name: "instant_eval",
            description:
              "Finding the traces needs reading each one and judging what was said or what the agent did (a tone, a language, a promise made, a topic discussed, a tool called with a wrong value, a claim no tool result backs, tests not re-run, a cache miss), and no listed evaluator or event already records it.",
          },
        ]
      : []),
    {
      name: "free_text",
      description:
        "The sentence is a literal string to look for in the traces: an id, an error message, a product name, a quoted phrase. A description of something that happened is not a literal string.",
    },
    ...(isLangyAvailable
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
  const hours = Math.max(1, Math.round((timeRange.to - timeRange.from) / 3_600_000));
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
    `Event names on this project: ${known.events.length > 0 ? known.events.join(", ") : "none"}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Whether the classifier picked one of the options it was offered. */
type InstantEvalRouteAnswer = { kind: "routed"; route: string } | { kind: "unrouted" };

/** The option the classifier picked; unrouted when it skipped or named one not offered. */
export function routeAnswerOf({
  judgement,
  question,
}: {
  judgement: InstantEvalJudgement;
  question: InstantEvalCategoryQuestion;
}): InstantEvalRouteAnswer {
  if (judgement.skippedReason !== void 0) return { kind: "unrouted" };
  const label = judgement.verdicts.find((verdict) => verdict.questionId === question.id)?.label;
  const offered = question.options.find((option) => option.name === label);
  return offered ? { kind: "routed", route: offered.name } : { kind: "unrouted" };
}
