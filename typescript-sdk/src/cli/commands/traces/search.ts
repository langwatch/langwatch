import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import {
  printResult,
  resolveOutputOptions,
  type RawOutputFlags,
} from "../../utils/output";
import { createCommandEvents, type CommandEvents } from "../../telemetry/events";
import { parseOriginOption } from "./origin-filter";

/** Traces are walked in chunks so the progress bar moves rather than jumping 0 → 1. */
const PROGRESS_CHUNK = 5;

export const searchTracesCommand = async (options: {
  query?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  origin?: string;
} & RawOutputFlags): Promise<void> => {
  checkApiKey();

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
      ? new Date(options.startDate).getTime()
      : oneDayAgo;
    const endDate = options.endDate
      ? new Date(options.endDate).getTime()
      : now;
    const pageSize = options.limit ? parseInt(options.limit, 10) : 25;
    const originFilter = parseOriginOption(options.origin);

    // The `format` option controls CLI output (table vs json); the API's
    // `format` parameter controls server response shape ("digest" | "json").
    // Always request the richer "json" shape and render locally.
    result = await service.search({
      query: options.query,
      startDate,
      endDate,
      pageSize,
      format: "json",
      ...(originFilter ? { filters: { "traces.origin": originFilter } } : {}),
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
  await printResult(result, {
    ...options,
    table: () => {
      if (traces.length === 0) {
        console.log();
        console.log(chalk.gray("No traces found matching your criteria."));
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
 * WHAT THIS FRACTION HONESTLY MEANS: the command issues ONE request — the API
 * exposes no cursor the CLI pages through — so this is progress over the traces
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
