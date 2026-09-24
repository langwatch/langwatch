import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import {
  printResult,
  resolveOutputOptions,
  type RawOutputFlags,
} from "../../utils/output";
import { createCommandEvents, type CommandEvents } from "../../telemetry/events";
import { parseInstantOrNull } from "../../utils/instant";
import { parseOriginOption } from "./origin-filter";

/** Traces are walked in chunks so the progress bar moves rather than jumping 0 → 1. */
const PROGRESS_CHUNK = 5;

/**
 * The text query is matched as a phrase, so a Lucene-style query returns zero
 * rows rather than an error, and zero rows reads like "you have none of those".
 * Measured against a project with 638 traces: "validation failed" matched 40,
 * "validation AND failed" matched 0. Named here so an empty result says which
 * of the two it is.
 */
const BOOLEAN_OPERATORS = /(^|\s)(AND|OR|NOT)(\s|$)/;

/**
 * A query carrying an email address. Email addresses are redacted before a
 * trace is stored whenever the project's data privacy settings redact PII,
 * which they do by default, so the text never holds one and the search finds
 * nothing however many traces mention it. Named so an empty result says so.
 */
const EMAIL_ADDRESS = /[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}/;

const EMAIL_HINT =
  "Email addresses are redacted before a trace is stored when the project redacts PII (the default), so a search for one finds nothing. Search by a thread id, a trace id or a name instead, or check the project's data privacy settings.";

/** What an empty result should say about the query, or nothing. */
export function emptySearchHint({
  query,
}: {
  query: string | undefined;
}): string | undefined {
  if (!query) return undefined;
  if (BOOLEAN_OPERATORS.test(query)) {
    return "The query is matched as plain text, so AND, OR and NOT are searched for as words. Try one phrase.";
  }
  if (EMAIL_ADDRESS.test(query)) return EMAIL_HINT;
  return undefined;
}

/**
 * The window flags take an ISO-8601 instant or epoch milliseconds, which is
 * what the Trace Explorer's page context and its links carry. `new Date()`
 * reads an integer string as a calendar date and answers NaN.
 */
const parseInstantFlag = (value: string, flag: string): number => {
  const parsed = parseInstantOrNull(value);
  if (parsed !== null) return parsed;
  console.error(
    `Invalid ${flag}: pass an ISO-8601 instant or epoch milliseconds.`,
  );
  process.exit(1);
};

export const searchTracesCommand = async (options: {
  query?: string;
  filter?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  origin?: string;
  errorsOnly?: boolean;
  project?: string;
} & RawOutputFlags): Promise<void> => {
  await resolveCredentials({ project: options.project });

  const service = new TracesApiService();
  const spinner = createSpinner("Searching traces...").start();
  // A frozen no-op unless a transport is configured — see ../../telemetry/events.
  const events = createCommandEvents({ resource: "trace", verb: "search" });

  let result: Awaited<ReturnType<TracesApiService["search"]>>;
  try {
    events.started("Searching traces…");

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const startDate = options.startDate
      ? parseInstantFlag(options.startDate, "--start-date")
      : oneDayAgo;
    const endDate = options.endDate
      ? parseInstantFlag(options.endDate, "--end-date")
      : now;
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
    result = await service.search({
      query: options.query,
      startDate,
      endDate,
      pageSize,
      format: "json",
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      // The filter language, sent as itself. `-q` stays free text: they are
      // two different searches and the server combines them, so sending one
      // as the other would silently change what was asked.
      ...(options.filter ? { filter: options.filter } : {}),
    });

    const matched = result.pagination.totalHits;

    // The stat card's number, and the first thing the panel can say that is not a
    // spinner: how many traces the query MATCHED — which is not how many came
    // back. Emitted the moment the response lands, before any rendering.
    events.count({
      count: matched,
      total: matched,
      message: `${matched.toLocaleString()} trace${matched === 1 ? "" : "s"} matched`,
    });

    spinner.succeed(
      `Found ${result.pagination.totalHits} trace${result.pagination.totalHits !== 1 ? "s" : ""} (showing ${result.traces.length})`,
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

  const traces = result.traces as Array<Record<string, unknown>>;
  const matched = result.pagination.totalHits;

  // Rendering stays OUTSIDE the search try: a printResult rejection (invalid
  // --jq) is a rendering failure, not a search failure.
  //
  // The machine branch comes FIRST: a machine caller must get the document
  // even when it holds zero traces — an empty `{ traces: [], pagination }`
  // is a parseable answer, prose on stdout is a corrupted one.
  if (resolveOutputOptions(options).format !== "table") {
    reportProgress({ events, total: traces.length, matched });
  }
  // The hint rides on the document too, so a machine caller reading zero
  // traces is told the cause the same way a person is.
  const hint =
    traces.length === 0 ? emptySearchHint({ query: options.query }) : undefined;
  await printResult(hint ? { ...result, hint } : result, {
    ...options,
    table: () => {
      if (traces.length === 0) {
        console.log();
        console.log(chalk.gray("No traces found matching your criteria."));
        if (hint) console.log(chalk.gray(hint));
        if (options.filter) {
          // A filter that parses and matches nothing is almost always a value
          // spelled the way a person would spell it rather than the way the
          // project records it, which is the one question facets answers.
          console.log(
            chalk.gray(
              `The filter parsed, so a value may be spelled differently here. Check with ${chalk.cyan("langwatch trace facets <field>")}.`,
            ),
          );
        }
        console.log(chalk.gray("Try widening your date range or search query."));
      } else {
        printTable({ events, traces, matched });
      }
    },
  });

  events.completed({
    count: traces.length,
    total: matched,
    message: `Returned ${traces.length} of ${matched.toLocaleString()} matching trace${matched === 1 ? "" : "s"}`,
  });
  await events.flush();
};

/**
 * Walk the returned traces in chunks, reporting how far along we are.
 *
 * WHAT THIS FRACTION HONESTLY MEANS: the command issues ONE request — search
 * renders a single page (the API does return a scrollId cursor, and `trace
 * export` is the command that walks it) — so this is progress over the traces
 * already in hand, not over a multi-page fetch. The rows really are being
 * processed, so the bar is not a lie; but it is not the long-running bar that
 * paging would give. Making the fetch page would change what a *disabled* CLI
 * does, and that is not a trade this feature is allowed to make.
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
  traces: Array<Record<string, unknown>>;
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
      chalk.gray(
        `Showing ${traces.length} of ${matched} total. Use --limit to see more.`,
      ),
    );
  }
  console.log(
    chalk.gray(
      `Use ${chalk.cyan("langwatch trace get <traceId>")} to view full details`,
    ),
  );
};

function toRow(trace: Record<string, unknown>): Record<string, string> {
  const traceId = (trace.traceId ?? trace.trace_id ?? trace.id ?? "—") as string;
  const rawInput = trace.input ?? trace.ComputedInput ?? "—";
  const rawOutput = trace.output ?? trace.ComputedOutput ?? "—";
  const input = truncate(typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput), 60);
  const output = truncate(typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput), 40);
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
