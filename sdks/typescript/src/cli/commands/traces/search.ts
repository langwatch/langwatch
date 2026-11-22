import chalk from "chalk";

import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";

import { createCommandEvents, type CommandEvents } from "../../telemetry/events";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { printResult, resolveOutputOptions, type RawOutputFlags } from "../../utils/output";
import { searchedProjectSlug } from "../../utils/searchedProject";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import {
  DEFAULT_LOOKBACK,
  resolveTimeWindow,
  resolveTimeWindowOrExit,
  type TimeWindow,
  WIDENED_LOOKBACK,
  windowDocument,
} from "../../utils/timeWindow";
import { parseOriginOption } from "./origin-filter";
import { type SearchedDocument, searchedDocument, searchedLines, widenCommand } from "./searched";

/** Traces are walked in chunks so the progress bar moves rather than jumping 0 → 1. */
const PROGRESS_CHUNK = 5;

/**
 * The text query is matched as a phrase, so a Lucene-style query returns
 * zero rows rather than an error -- reading like "you have none of those".
 * Named here so an empty result says which of the two it is.
 */
const BOOLEAN_OPERATORS = /(^|\s)(AND|OR|NOT)(\s|$)/;

/**
 * A query carrying an email address. PII redaction (on by default) strips
 * them before a trace is stored, so such a search always finds nothing.
 */
const EMAIL_ADDRESS = /[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}/;

const EMAIL_HINT =
  "Email addresses are redacted before a trace is stored when the project redacts PII (the default), so a search for one finds nothing. Search by a thread id, a trace id or a name instead, or check the project's data privacy settings.";

/** What an empty result should say about the query, or nothing. */
export function emptySearchHint({
  query,
  found,
}: {
  query: string | undefined;
  found: number;
}): string | undefined {
  if (found > 0 || !query) return undefined;
  if (BOOLEAN_OPERATORS.test(query)) {
    return "The query is matched as plain text, so AND, OR and NOT are searched for as words. Try one phrase.";
  }
  if (EMAIL_ADDRESS.test(query)) return EMAIL_HINT;
  return undefined;
}

type SearchResult = Awaited<ReturnType<TracesApiService["search"]>>;

type SearchOptions = {
  query?: string;
  filter?: string;
  startDate?: string;
  endDate?: string;
  since?: string;
  limit?: string;
  origin?: string;
  errorsOnly?: boolean;
  project?: string;
} & RawOutputFlags;

/** What a search found, in which window, and whether the default window was widened. */
interface WindowedSearch {
  result: SearchResult;
  window: TimeWindow;
  widened: boolean;
}

/**
 * A trace seen "a while ago" sits outside the default week more often than it
 * is missing, so an empty default window widens once. A window the caller
 * named is the one they meant and never widens.
 */
const searchWithWidening = async ({
  search,
  window,
  spinner,
}: {
  search: (window: TimeWindow) => Promise<SearchResult>;
  window: TimeWindow;
  spinner: ReturnType<typeof createSpinner>;
}): Promise<WindowedSearch> => {
  const first = await search(window);
  if (first.traces.length > 0 || window.isExplicit) {
    return { result: first, window, widened: false };
  }
  spinner.text = `Nothing in the last ${DEFAULT_LOOKBACK}, searching the last ${WIDENED_LOOKBACK}...`;
  const wider = {
    ...resolveTimeWindow({ since: WIDENED_LOOKBACK, now: window.to }),
    isExplicit: false,
  };
  return { result: await search(wider), window: wider, widened: true };
};

export const searchTracesCommand = async (options: SearchOptions): Promise<void> => {
  // The window is checked before the credential: a bad date is the caller's to
  // fix whether or not a key is configured.
  const requested = resolveTimeWindowOrExit({
    startDate: options.startDate,
    endDate: options.endDate,
    since: options.since,
    now: Date.now(),
  });

  await resolveCredentials({ project: options.project });

  const service = new TracesApiService();
  const spinner = createSpinner("Searching traces...").start();
  // A frozen no-op unless a transport is configured — see ../../telemetry/events.
  const events = createCommandEvents({ resource: "trace", verb: "search" });

  const pageSize = options.limit ? parseInt(options.limit, 10) : 25;
  const originFilter = parseOriginOption(options.origin);
  // "Show me my failed traces" has no text to search for: the error lives on
  // the span, not in the trace's indexed text, so `-q error` returns nothing
  // and reads like a clean project. `traces.error` is the same filter the
  // Trace Explorer's error toggle uses.
  const filters = {
    ...(originFilter ? { "traces.origin": originFilter } : {}),
    ...(options.errorsOnly ? { "traces.error": ["true"] } : {}),
  };

  // The `format` option controls CLI output (table vs json); the API's
  // `format` parameter controls server response shape ("digest" | "json").
  // Always request the richer "json" shape and render locally.
  const search = ({ from, to }: TimeWindow): Promise<SearchResult> =>
    service.search({
      query: options.query,
      startDate: from,
      endDate: to,
      pageSize,
      format: "json",
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      // The filter language, sent as itself. `-q` stays free text: they are
      // two different searches and the server combines them, so sending one
      // as the other would silently change what was asked.
      ...(options.filter ? { filter: options.filter } : {}),
    });

  let found: WindowedSearch;
  try {
    events.started("Searching traces…");

    found = await searchWithWidening({ search, window: requested, spinner });
    const matched = found.result.pagination.totalHits;

    // The stat card's number, and the first thing the panel can say that is not a
    // spinner: how many traces the query MATCHED — which is not how many came
    // back. Emitted the moment the response lands, before any rendering.
    events.count({
      count: matched,
      total: matched,
      message: `${matched.toLocaleString()} trace${matched === 1 ? "" : "s"} matched`,
    });

    spinner.succeed(
      `Found ${matched} trace${matched !== 1 ? "s" : ""} (showing ${found.result.traces.length})`,
    );
  } catch (error) {
    events.failed({ error, message: "Trace search failed" });
    // Flush BEFORE exiting: `process.exit` does not run the `finally` below.
    await events.flush();
    // No explicit `format`: the program's preAction hook has already recorded
    // the resolved format for EVERY spelling (`-o json`, `--agent`, `-f json`),
    // and this command's `-f` carries a commander default ("table") that would
    // otherwise override the hook and print prose at a machine caller.
    failSpinner({ spinner, error, action: "search traces" });
    process.exit(1);
  } finally {
    await events.flush();
  }

  // Rendering stays OUTSIDE the search try: a printResult rejection is a
  // rendering failure, not a search failure.
  await renderSearch({ options, found, events, origin: originFilter });
};

const renderSearch = async ({
  options,
  found,
  events,
  origin,
}: {
  options: SearchOptions;
  found: WindowedSearch;
  events: CommandEvents;
  origin: string[] | undefined;
}): Promise<void> => {
  const { result, window, widened } = found;
  const traces = result.traces as Record<string, unknown>[];
  const matched = result.pagination.totalHits;

  // The machine branch comes FIRST: an empty `{ traces: [], pagination }` is
  // a parseable answer; prose on stdout is a corrupted one.
  if (resolveOutputOptions(options).format !== "table") {
    reportProgress({ events, total: traces.length, matched });
  }
  // The hint, the window and what an empty read searched ride on the document
  // too, so a machine caller reading zero traces is told what a person is.
  const hint = emptySearchHint({ query: options.query, found: traces.length });
  const empty = traces.length === 0 ? await describeEmpty({ options, window, origin }) : undefined;
  const windowDoc = windowDocument({
    window,
    lookback: widened ? WIDENED_LOOKBACK : DEFAULT_LOOKBACK,
    widened,
  });
  await printResult(
    {
      ...withHint({ document: result, hint }),
      window: windowDoc,
      ...(empty ? { searched: empty.searched, widen: empty.widen ?? null } : {}),
    },
    {
      ...options,
      table: () => {
        if (empty) {
          printEmptySearch({ hint, filter: options.filter, empty, widened });
          return;
        }
        if (widened) printWidenedNote();
        printTable({ events, traces, matched });
      },
    },
  );

  events.completed({
    count: traces.length,
    total: matched,
    message: `Returned ${traces.length} of ${matched.toLocaleString()} matching trace${matched === 1 ? "" : "s"}`,
  });
  await events.flush();
};

interface EmptySearch {
  searched: SearchedDocument;
  /** The exact command that searches a wider window, or undefined once a year was read. */
  widen: string | undefined;
}

const describeEmpty = async ({
  options,
  window,
  origin,
}: {
  options: { query?: string; filter?: string; errorsOnly?: boolean; project?: string };
  window: TimeWindow;
  origin: string[] | undefined;
}): Promise<EmptySearch> => {
  const input = {
    project: await searchedProjectSlug({ project: options.project }),
    window,
    query: options.query,
    filter: options.filter,
    origin,
    errorsOnly: options.errorsOnly,
  };
  return {
    searched: searchedDocument(input),
    widen: widenCommand({
      base: "langwatch trace search",
      searched: input,
      project: options.project,
    }),
  };
};

const printWidenedNote = (): void => {
  console.log();
  console.log(
    chalk.gray(
      `Nothing in the last ${DEFAULT_LOOKBACK}, so this searched the last ${WIDENED_LOOKBACK}. Set the window with --since or --start-date.`,
    ),
  );
};

/**
 * Walks the returned traces in chunks, reporting progress -- over traces
 * already in hand from one request (search renders a single page; `trace
 * export` walks the scrollId cursor), not a multi-page fetch.
 */
const reportProgress = ({
  events,
  total,
  matched,
  onChunk,
}: {
  events: CommandEvents;
  total: number;
  matched: number;
  onChunk?: (from: number, to: number) => void;
}): void => {
  for (let done = 0; done < total; done += PROGRESS_CHUNK) {
    const to = Math.min(done + PROGRESS_CHUNK, total);
    onChunk?.(done, to);
    events.progress({
      progress: to / total,
      count: to,
      total,
      message: `Processed ${to} of ${total} trace${total === 1 ? "" : "s"} (${matched.toLocaleString()} matched)`,
    });
  }
};

const printTable = ({
  events,
  traces,
  matched,
}: {
  events: CommandEvents;
  traces: Record<string, unknown>[];
  matched: number;
}): void => {
  console.log();

  const tableData: Record<string, string>[] = [];
  reportProgress({
    events,
    total: traces.length,
    matched,
    onChunk: (from, to) => {
      for (const trace of traces.slice(from, to)) tableData.push(toRow(trace));
    },
  });

  formatTable({
    data: tableData,
    headers: ["Trace ID", "Input", "Output", "Time"],
    colorMap: {
      "Trace ID": chalk.green,
      Input: chalk.cyan,
    },
  });

  console.log();
  if (matched > traces.length) {
    console.log(
      chalk.gray(`Showing ${traces.length} of ${matched} total. Use --limit to see more.`),
    );
  }
  console.log(
    chalk.gray(`Use ${chalk.cyan("langwatch trace get <traceId>")} to view full details`),
  );
};

function toRow(trace: Record<string, unknown>): Record<string, string> {
  const traceId = (trace.traceId ?? trace.trace_id ?? trace.id ?? "—") as string;
  const rawInput = trace.input ?? trace.ComputedInput ?? "—";
  const rawOutput = trace.output ?? trace.ComputedOutput ?? "—";
  const input = truncate(typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput), 60);
  const output = truncate(
    typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput),
    40,
  );
  const timestamps = trace.timestamps as Record<string, unknown> | undefined;
  const startedAt = timestamps?.started_at ?? trace.StartedAt ?? trace.startedAt;
  const timeStr = startedAt ? formatRelativeTime(new Date(startedAt as number).toISOString()) : "—";

  return {
    "Trace ID": traceId.substring(0, 20),
    Input: input,
    Output: output,
    Time: timeStr,
  };
}

function truncate(str: string, maxLen: number): string {
  const cleaned = str.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen - 1) + "…";
}

function withHint<T extends object>({
  document,
  hint,
}: {
  document: T;
  hint: string | undefined;
}): T | (T & { hint: string }) {
  return hint ? { ...document, hint } : document;
}

function printEmptySearch({
  hint,
  filter,
  empty,
  widened,
}: {
  hint: string | undefined;
  filter: string | undefined;
  empty: EmptySearch;
  widened: boolean;
}): void {
  console.log();
  console.log(
    chalk.gray(
      widened
        ? `No traces found in the last ${DEFAULT_LOOKBACK}, nor after widening to the last ${WIDENED_LOOKBACK}. Searched:`
        : "No traces found. Searched:",
    ),
  );
  for (const line of searchedLines(empty.searched)) console.log(chalk.gray(`  ${line}`));
  if (hint) console.log(chalk.gray(hint));
  if (filter) {
    // A filter that parses and matches nothing is almost always a value
    // spelled the way a person would spell it rather than the way the
    // project records it, which is the one question facets answers.
    console.log(
      chalk.gray(
        `The filter parsed, so a value may be spelled differently here. Check with ${chalk.cyan("langwatch trace facets <field>")}.`,
      ),
    );
  }
  if (empty.widen) {
    console.log(chalk.gray(`Search further back: ${chalk.cyan(empty.widen)}`));
  }
  console.log(
    chalk.gray(
      `Another project: add ${chalk.cyan("--project <slug>")}. A known trace ID: ${chalk.cyan("langwatch trace get <traceId>")}.`,
    ),
  );
}
