import { searchTraces as apiSearchTraces } from "../langwatch-api.js";
import { parseRelativeDate } from "../utils/date-parsing.js";
import { formatEvaluationLines } from "../utils/format-evaluations.js";
import { looksLikeTraceId } from "../utils/trace-id-shape.js";

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/** Default window for a text search. */
const TEXT_SEARCH_WINDOW_MS = DAY_MS;

/**
 * Default window when the caller names trace ids. Naming ids is an exact-match
 * intent, so answering it against yesterday alone is a false negative by
 * construction. 90 days mirrors the platform's
 * `TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS` — the bound its own id resolution
 * already accepts, chosen because `trace_summaries` is
 * `PARTITION BY toYearWeek(OccurredAt)`, so an unbounded id lookup opens every
 * weekly partition including cold storage on S3 (ADR-132).
 */
const ID_LOOKUP_WINDOW_MS = 90 * DAY_MS;

function describeSpan(ms: number): string {
  if (ms % DAY_MS === 0) {
    const days = ms / DAY_MS;
    return days === 1 ? "24 hours" : `${days} days`;
  }
  const hours = Math.round(ms / HOUR_MS);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** The next sensible window to offer, or undefined once the span is already wide. */
function suggestWiderWindow(spanMs: number): string | undefined {
  if (spanMs < 7 * DAY_MS) return "7d";
  if (spanMs < 30 * DAY_MS) return "30d";
  if (spanMs < 90 * DAY_MS) return "90d";
  return undefined;
}

/**
 * An empty result is the one moment the caller needs a redirect, and it used to
 * be the one place that carried none — the tip naming `get_trace` printed only
 * on the success path. It now always states the window it searched and always
 * names the tool that looks an id up, whatever the query looked like; the
 * id-shape line is an extra sentence on top, never a change of behaviour.
 */
function buildEmptyResult({
  query,
  spanMs,
  windowWasDefaulted,
  startDate,
  endDate,
}: {
  query?: string;
  spanMs: number;
  windowWasDefaulted: boolean;
  startDate: number;
  endDate: number;
}): string {
  const lines = ["No traces found matching your query.", ""];

  const range = `${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`;
  lines.push(
    windowWasDefaulted
      ? `Searched the last ${describeSpan(spanMs)} (the default): ${range}.`
      : `Searched ${range}.`,
  );
  lines.push("", "Tips:");

  if (query && looksLikeTraceId(query)) {
    lines.push(
      `- "${query}" looks like a trace id. Free text never matches trace ids — use \`get_trace\` with traceId: "${query}".`,
    );
  }

  const wider = suggestWiderWindow(spanMs);
  if (wider) {
    lines.push(
      `- Widen the window with startDate, e.g. startDate: "${wider}". Accepts h (hours), d (days), w (weeks), m (30-day months), or an ISO date.`,
    );
  }

  lines.push(
    "- Looking up a known trace id? `get_trace` takes a traceId and applies no time window.",
    "- To fetch several known trace ids at once, pass `traceIds` instead of `query`.",
  );

  return lines.join("\n");
}

/**
 * Handles the search_traces MCP tool invocation.
 *
 * Searches LangWatch traces with optional filters, text query, explicit trace
 * ids, and date range. In digest mode (default), returns AI-readable formatted
 * digests per trace. In json mode, returns the full raw JSON.
 */
export async function handleSearchTraces(params: {
  query?: string;
  traceIds?: string[];
  filters?: Record<string, string[]>;
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  scrollId?: string;
  format?: "digest" | "json";
}): Promise<string> {
  const now = Date.now();
  const namesTraceIds = (params.traceIds?.length ?? 0) > 0;
  const defaultSpanMs = namesTraceIds ? ID_LOOKUP_WINDOW_MS : TEXT_SEARCH_WINDOW_MS;

  const startDate = params.startDate
    ? parseRelativeDate(params.startDate)
    : now - defaultSpanMs;
  const endDate = params.endDate ? parseRelativeDate(params.endDate) : now;
  const format = params.format ?? "digest";

  const result = await apiSearchTraces({
    query: params.query,
    traceIds: params.traceIds,
    filters: params.filters,
    startDate,
    endDate,
    pageSize: params.pageSize ?? 25,
    scrollId: params.scrollId,
    format,
  });

  const traces = result.traces ?? [];
  if (traces.length === 0) {
    return buildEmptyResult({
      query: params.query,
      spanMs: endDate - startDate,
      windowWasDefaulted: !params.startDate,
      startDate,
      endDate,
    });
  }

  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];
  lines.push(`Found ${result.pagination?.totalHits ?? traces.length} traces:\n`);

  for (const trace of traces) {
    lines.push(`### Trace: ${trace.trace_id}`);

    if (trace.formatted_trace) {
      lines.push(trace.formatted_trace);
    } else {
      const inputStr = trace.input?.value ? String(trace.input.value) : "N/A";
      const outputStr = trace.output?.value ? String(trace.output.value) : "N/A";
      lines.push(
        `- **Input**: ${inputStr.slice(0, 100)}${inputStr.length > 100 ? "..." : ""}`,
      );
      lines.push(
        `- **Output**: ${outputStr.slice(0, 100)}${outputStr.length > 100 ? "..." : ""}`,
      );
    }

    if (trace.timestamps) {
      lines.push(`- **Time**: ${trace.timestamps.started_at || "N/A"}`);
    }
    if (trace.error) {
      lines.push(`- **Error**: ${JSON.stringify(trace.error)}`);
    }
    if (trace.evaluations && trace.evaluations.length > 0) {
      lines.push(...formatEvaluationLines(trace.evaluations));
    }
    lines.push("");
  }

  if (result.pagination?.scrollId) {
    lines.push(
      `\n**More results available.** Use scrollId: "${result.pagination.scrollId}" to get next page.`,
    );
  }

  lines.push(
    '\n> Tip: Use `get_trace` with a trace_id for full details. Use `search_traces` with `format: "json"` for raw data. Use `discover_schema` to see available filter fields.',
  );

  return lines.join("\n");
}
