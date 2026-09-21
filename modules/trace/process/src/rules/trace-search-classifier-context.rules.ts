/**
 * What the classifier is asked, and the context it reads the sentence next to.
 * Both are pinned by tests: a change here changes every routing decision the
 * product makes. @see ADR-144
 */

import {
  SEARCH_FIELDS,
  SEARCH_ROUTE_KINDS,
  type KnownProjectSignals,
  type RouteSearchAvailability,
  type SearchRouteKind,
} from "@langwatch/trace-contract";

/** The lens whose rows are conversations, so its eval judges threads. */
export const CONVERSATIONS_LENS_ID = "conversations";

export const ROUTE_QUESTION_ID = "route";

/** One option the classifier may answer the routing question with. */
export interface TraceSearchRouteOption {
  name: string;
  description: string;
}

/**
 * The routing question, in the shape a classifier takes. Declared here rather
 * than imported: the judge belongs to another module, and this is what the
 * router asks of whoever the composition supplies.
 */
export interface TraceSearchRouteQuestion {
  id: string;
  kind: "category";
  instructions: string;
  options: TraceSearchRouteOption[];
}

/** How the classifier is asked. Exported so the prompt is pinned by a test. */
export function buildRouteQuestion({
  isLangyAvailable,
  isInstantEvalAvailable = true,
}: Pick<RouteSearchAvailability, "isLangyAvailable"> &
  Partial<Pick<RouteSearchAvailability, "isInstantEvalAvailable">>): TraceSearchRouteQuestion {
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

/** Whether the classifier's label is one of the routes we offer. */
export function isRouteKind(value: unknown): value is SearchRouteKind {
  return typeof value === "string" && (SEARCH_ROUTE_KINDS as readonly string[]).includes(value);
}
