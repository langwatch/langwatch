import chalk from "chalk";
import fs from "fs";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import {
  type CommandEvents,
  createCommandEvents,
} from "../../telemetry/events";
import { resolveCredentials } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { parseOriginOption } from "./origin-filter";

/** Rows are serialised in chunks so the progress bar moves as the file is built. */
const PROGRESS_CHUNK = 25;

/**
 * The server clamps pageSize to this; limits above one page are satisfied by
 * walking the keyset cursor the search endpoint returns in
 * `pagination.scrollId`.
 */
const SERVER_PAGE_CAP = 1000;

/**
 * Page size used when spans are requested. Each coding-agent trace's spans
 * are joined with a bounded but heavy per-trace log read server-side, so the
 * CLI asks for smaller pages and lets the cursor walk cover the rest — same
 * total work, no long single request.
 */
const SPANS_PAGE_CAP = 200;

/** Bound each page request so a quiet socket cannot hold the export open forever. */
const REQUEST_TIMEOUT_MS = 60_000;

interface ExportedTrace {
  trace_id: string;
  input?: { value: string };
  output?: { value: string };
  timestamps?: { started_at?: number };
  metadata?: Record<string, unknown>;
  metrics?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_cost?: number | null;
    context_size_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    reasoning_tokens?: number | null;
  };
  spans?: unknown[];
  error?: Record<string, unknown>;
}

interface SearchPage {
  traces: ExportedTrace[];
  pagination?: { totalHits?: number; scrollId?: string; skipped?: number };
}

export const exportTracesCommand = async (options: {
  startDate?: string;
  endDate?: string;
  query?: string;
  format?: string;
  output?: string;
  limit?: string;
  origin?: string;
  includeSpans?: boolean;
}): Promise<void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const format = options.format ?? "jsonl";
  if (format !== "csv" && format !== "jsonl" && format !== "json") {
    console.error(chalk.red("Error: --format must be csv, jsonl, or json"));
    process.exit(1);
  }

  const now = Date.now();
  const startDate = options.startDate
    ? new Date(options.startDate).getTime()
    : now - 7 * 24 * 60 * 60 * 1000; // 7 days ago
  const endDate = options.endDate ? new Date(options.endDate).getTime() : now;

  const limit = options.limit ? Number(options.limit) : 1000;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    console.error(
      chalk.red(
        `Error: --limit must be a positive whole number, got "${options.limit}"`,
      ),
    );
    process.exit(1);
  }
  const originFilter = parseOriginOption(options.origin);
  const spinner = createSpinner(`Exporting traces (${format})...`).start();
  const events = createCommandEvents({ resource: "trace", verb: "export" });

  try {
    events.started(`Exporting traces as ${format}…`);

    const traces: ExportedTrace[] = [];
    let matched = 0;
    let scrollId: string | undefined;

    // Page until the requested limit is met or the result set is exhausted.
    // The cursor is authoritative for "there may be more"; a page shorter than
    // requested only ends the walk when the shortfall is not accounted for by
    // server-side `skipped` rows (traces dropped because they failed to
    // serialize), since the cursor advances past those.
    for (;;) {
      const pageSize = Math.min(
        limit - traces.length,
        options.includeSpans ? SPANS_PAGE_CAP : SERVER_PAGE_CAP,
      );

      const response = await fetch(`${endpoint}/api/traces/search`, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders({ apiKey }),
        },
        body: JSON.stringify({
          query: options.query,
          startDate,
          endDate,
          pageSize,
          format: "json",
          ...(options.includeSpans ? { includeSpans: true } : {}),
          ...(scrollId ? { scrollId } : {}),
          ...(originFilter
            ? { filters: { "traces.origin": originFilter } }
            : {}),
        }),
      });

      if (!response.ok) {
        // Read the body off a CLONE before `formatFetchError` consumes it, so the
        // event keeps the platform's real error kind instead of degrading to one
        // guessed from the status.
        const body: unknown = await response
          .clone()
          .json()
          .catch(() => undefined);

        const message = await formatFetchError(response);
        events.failed({
          error: Object.assign(new Error(message), {
            status: response.status,
            originalError: body,
          }),
          message: "Trace export failed",
        });
        await events.flush();

        failSpinner({
          spinner,
          error: new Error(message),
          action: "export traces",
        });
        process.exit(1);
      }

      const data = (await response.json()) as SearchPage;
      const pageTraces = data.traces;
      // Truncate on write so no page, whatever its size, can push the output
      // past the caller's --limit.
      traces.push(...pageTraces.slice(0, limit - traces.length));
      matched = data.pagination?.totalHits ?? traces.length;

      if (traces.length === pageTraces.length) {
        // First page: report the match count the moment it is known.
        events.count({
          count: matched,
          total: matched,
          message: `${matched.toLocaleString()} trace${matched === 1 ? "" : "s"} to export`,
        });
      }

      spinner.text = `Exporting traces (${format})... ${traces.length.toLocaleString()} fetched`;

      scrollId = data.pagination?.scrollId;
      const consumed = pageTraces.length + (data.pagination?.skipped ?? 0);
      const exhausted = pageTraces.length === 0 || consumed < pageSize;
      if (!scrollId || exhausted || traces.length >= limit) break;
    }

    spinner.succeed(
      `Exported ${traces.length} trace${traces.length !== 1 ? "s" : ""}${matched > traces.length ? ` (${matched} total)` : ""}`,
    );

    // Serialising each trace is real per-row work, so this progress is genuinely
    // the file being built — not a bar invented for the sake of having one.
    const output = serialise({ events, traces, format, matched });

    if (options.output) {
      fs.writeFileSync(options.output, output);
      console.log(chalk.green(`Written to ${options.output}`));
    } else {
      process.stdout.write(output);
    }

    events.completed({
      count: traces.length,
      total: matched,
      message: `Exported ${traces.length} trace${traces.length === 1 ? "" : "s"} as ${format}`,
    });
  } catch (error) {
    events.failed({ error, message: "Trace export failed" });
    await events.flush();
    // No explicit `format`: this command's `--format` is a FILE format (jsonl
    // etc.), not an error-output format — the preAction hook already recorded
    // the resolved output format, which correctly stays human here.
    failSpinner({ spinner, error, action: "export traces" });
    process.exit(1);
  } finally {
    await events.flush();
  }
};

/**
 * CSV columns. The first five are the original export shape and their order is
 * a compatibility contract for existing consumers; token metric columns are
 * only ever appended after them.
 */
const CSV_HEADERS = [
  "trace_id",
  "input",
  "output",
  "started_at",
  "error",
  "prompt_tokens",
  "completion_tokens",
  "total_cost",
  "context_size_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_tokens",
] as const;

/** Build the export document, reporting progress as the rows are written. */
const serialise = ({
  events,
  traces,
  format,
  matched,
}: {
  events: CommandEvents;
  traces: ExportedTrace[];
  format: string;
  matched: number;
}): string => {
  const lines: string[] = [];

  for (let done = 0; done < traces.length; done += PROGRESS_CHUNK) {
    const to = Math.min(done + PROGRESS_CHUNK, traces.length);

    for (const trace of traces.slice(done, to)) {
      lines.push(serialiseTrace({ trace, format }));
    }

    events.progress({
      progress: to / traces.length,
      count: to,
      total: traces.length,
      message: `Wrote ${to} of ${traces.length} trace${traces.length === 1 ? "" : "s"} (${matched.toLocaleString()} matched)`,
    });
  }

  if (format === "json") return JSON.stringify(traces, null, 2);
  if (format === "jsonl") return lines.join("\n") + "\n";

  return [CSV_HEADERS.join(","), ...lines].join("\n") + "\n";
};

const serialiseTrace = ({
  trace,
  format,
}: {
  trace: ExportedTrace;
  format: string;
}): string => {
  if (format !== "csv") return JSON.stringify(trace);

  return [
    trace.trace_id,
    csvEscape(trace.input?.value ?? ""),
    csvEscape(trace.output?.value ?? ""),
    trace.timestamps?.started_at
      ? new Date(trace.timestamps.started_at).toISOString()
      : "",
    trace.error ? csvEscape(JSON.stringify(trace.error)) : "",
    csvNumber(trace.metrics?.prompt_tokens),
    csvNumber(trace.metrics?.completion_tokens),
    csvNumber(trace.metrics?.total_cost),
    csvNumber(trace.metrics?.context_size_tokens),
    csvNumber(trace.metrics?.cache_read_input_tokens),
    csvNumber(trace.metrics?.cache_creation_input_tokens),
    csvNumber(trace.metrics?.reasoning_tokens),
  ].join(",");
};

function csvNumber(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
