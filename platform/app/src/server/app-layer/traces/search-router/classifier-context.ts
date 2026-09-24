/**
 * What the classifier is asked, and the context it reads the sentence next to.
 *
 * One category question over four options, and one block naming the lens, the
 * window, the query already applied and the signals the project has. Both are
 * pinned by tests: a change here changes every routing decision the product
 * makes.
 *
 * @see ./route-search.ts: what is done with the answer
 * @see ../../../../../../specs/traces-v2/search.feature
 */

import type { InstantEvalCategoryQuestion } from "~/server/app-layer/instant-evals/classifier/classifier";
import type { KnownProjectSignals } from "../ai-query";
import { SEARCH_FIELDS } from "../query-language/metadata";
import {
  type RouteAvailability,
  SEARCH_ROUTE_KINDS,
  type SearchRouteKind,
} from "./contracts";

/** The lens whose rows are conversations, so its eval judges threads. */
export const CONVERSATIONS_LENS_ID = "conversations";

export const ROUTE_QUESTION_ID = "route";

/** How the classifier is asked. Exported so the prompt is pinned by a test. */
export function buildRouteQuestion({
  isLangyAvailable,
  isInstantEvalAvailable = true,
}: Pick<RouteAvailability, "isLangyAvailable"> &
  Partial<
    Pick<RouteAvailability, "isInstantEvalAvailable">
  >): InstantEvalCategoryQuestion {
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
              "Finding the traces needs reading each one and judging its content (a tone, a language, a promise made, a topic discussed), and no listed evaluator or event already records it.",
          },
        ]
      : []),
    {
      name: "free_text",
      description:
        "The sentence is a literal string to look for in the traces: an id, an error message, a product name, a quoted phrase.",
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

/** Whether the classifier's label is one of the routes we offer. */
export function isRouteKind(value: unknown): value is SearchRouteKind {
  return (
    typeof value === "string" &&
    (SEARCH_ROUTE_KINDS as readonly string[]).includes(value)
  );
}
