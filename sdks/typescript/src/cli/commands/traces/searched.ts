/**
 * What an empty trace read says about itself: the project, window, query and
 * filters it searched, and the exact command that searches wider. An empty
 * answer that names none of these reads as "there is no such trace".
 */
import { commandLine, type TimeWindow, widerLookback } from "../../utils/timeWindow";

export interface SearchedDocument {
  /** The project slug, or null when it could not be looked up. */
  project: string | null;
  from: string;
  to: string;
  query: string | null;
  filter: string | null;
  origin: string[] | null;
  errorsOnly: boolean;
  /** The trace fields the free-text query was matched against, or null without a query. */
  queryFields: readonly string[] | null;
}

/** Free text matches the trace's input, output and name, and span names; not span content. */
export const FREE_TEXT_FIELDS = ["input", "output", "name", "span names"] as const;

export interface SearchedInput {
  project: string | null;
  window: TimeWindow;
  query?: string;
  filter?: string;
  origin?: string[];
  errorsOnly?: boolean;
}

/** The query as searched: a blank `-q ""` searches no text, so it reads as no query. */
const searchedQuery = (query: string | undefined): string | null =>
  query === undefined || query.trim() === "" ? null : query;

export const searchedDocument = (input: SearchedInput): SearchedDocument => ({
  project: input.project,
  from: new Date(input.window.from).toISOString(),
  to: new Date(input.window.to).toISOString(),
  query: searchedQuery(input.query),
  filter: input.filter ?? null,
  origin: input.origin ?? null,
  errorsOnly: input.errorsOnly === true,
  queryFields: searchedQuery(input.query) === null ? null : FREE_TEXT_FIELDS,
});

/**
 * Where text that a free-text search missed may still be: inside a span. Null
 * without a query. Spans are read per trace, so the way in is `trace get`.
 */
export const spanSearchSuggestion = (searched: SearchedDocument): string | null =>
  searched.query === null
    ? null
    : `The text query matches each trace's input, output and name and its span names, not span content (tool calls, retrieved documents, intermediate LLM calls). To look inside spans, list candidate traces without -q (narrow with --filter or the time window), open one with \`langwatch trace get <traceId> -o json\` and grep its spans for "${searched.query}".`;

/** The same read over the next wider lookback, or undefined once a year was searched. */
export const widenCommand = ({
  base,
  searched,
  project,
}: {
  base: string;
  searched: SearchedInput;
  /** The `--project` the caller passed, repeated so the command reads the same project. */
  project?: string;
}): string | undefined => {
  const since = widerLookback({ window: searched.window });
  if (since === undefined) return undefined;
  return commandLine({
    base,
    flags: [
      ["-q", searched.query],
      ["--filter", searched.filter],
      ["--origin", searched.origin?.join(",")],
      ["--errors-only", searched.errorsOnly ? true : undefined],
      ["--project", project],
      ["--since", since],
    ],
  });
};

/** The searched read as lines a person scans. */
export const searchedLines = (searched: SearchedDocument): string[] => [
  `Project: ${searched.project ?? "the project of the current API key"}`,
  `Window:  ${searched.from} to ${searched.to}`,
  ...(searched.query === null
    ? []
    : [`Query:   ${searched.query} (matched against ${searched.queryFields?.join(", ")})`]),
  ...(searched.filter === null ? [] : [`Filter:  ${searched.filter}`]),
  ...(searched.origin === null ? [] : [`Origin:  ${searched.origin.join(", ")}`]),
  ...(searched.errorsOnly ? ["Errors only"] : []),
];
