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
}

export interface SearchedInput {
  project: string | null;
  window: TimeWindow;
  query?: string;
  filter?: string;
  origin?: string[];
  errorsOnly?: boolean;
}

export const searchedDocument = (input: SearchedInput): SearchedDocument => ({
  project: input.project,
  from: new Date(input.window.from).toISOString(),
  to: new Date(input.window.to).toISOString(),
  query: input.query ?? null,
  filter: input.filter ?? null,
  origin: input.origin ?? null,
  errorsOnly: input.errorsOnly === true,
});

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
  ...(searched.query === null ? [] : [`Query:   ${searched.query}`]),
  ...(searched.filter === null ? [] : [`Filter:  ${searched.filter}`]),
  ...(searched.origin === null ? [] : [`Origin:  ${searched.origin.join(", ")}`]),
  ...(searched.errorsOnly ? ["Errors only"] : []),
];
