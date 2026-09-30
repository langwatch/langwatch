import { searchTraces as apiSearchTraces, type TraceSearchResult } from "../langwatch-api.ts";
import { parseRelativeDate } from "../utils/date-parsing.ts";
import { formatEvaluationLines } from "../utils/format-evaluations.ts";
import { looksLikeTraceId } from "../utils/trace-id-shape.ts";

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/** Default window for a text search. */
const TEXT_SEARCH_WINDOW_MS = DAY_MS;

/**
 * Default window when trace ids are named: an exact-match intent must not be
 * answered against yesterday alone. Mirrors the platform's 90-day id lookup
 * bound (ADR-164).
 */
const ID_LOOKUP_WINDOW_MS = 90 * DAY_MS;

function previewLine({
  label,
  text,
}: {
  label: string;
  text: { value: string } | undefined;
}): string {
  const value = text?.value ? String(text.value) : "N/A";
  return `- **${label}**: ${value.slice(0, 100)}${value.length > 100 ? "..." : ""}`;
}

function traceLines(trace: TraceSearchResult): string[] {
  const lines = [`### Trace: ${trace.trace_id}`];

  if (trace.formatted_trace) {
    lines.push(trace.formatted_trace);
  } else {
    lines.push(previewLine({ label: "Input", text: trace.input }));
    lines.push(previewLine({ label: "Output", text: trace.output }));
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
  return lines;
}

function describeSpan({ ms }: { ms: number }): string {
  if (ms % DAY_MS === 0) {
    const days = ms / DAY_MS;
    return days === 1 ? "24 hours" : `${days} days`;
  }
  const hours = Math.round(ms / HOUR_MS);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** The next sensible window to offer, or undefined once the span is already wide. */
function suggestWiderWindow({ spanMs }: { spanMs: number }): string | undefined {
  if (spanMs < 7 * DAY_MS) return "7d";
  if (spanMs < 30 * DAY_MS) return "30d";
  if (spanMs < 90 * DAY_MS) return "90d";
  return undefined;
}

/** An empty result states the searched window and names the tool that looks an id up. */
function buildEmptyResult({
  query,
  traceIds,
  spanMs,
  windowWasDefaulted,
  startDate,
  endDate,
}: {
  query?: string;
  traceIds?: string[];
  spanMs: number;
  windowWasDefaulted: boolean;
  startDate: number;
  endDate: number;
}): string {
  const hasTraceIds = (traceIds?.length ?? 0) > 0;
  const lines = [
    hasTraceIds
      ? "No traces matched the requested trace ids in the searched window."
      : "No traces found matching your query.",
    "",
  ];

  const range = `${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`;
  lines.push(
    windowWasDefaulted
      ? `Searched the last ${describeSpan({ ms: spanMs })} (the default): ${range}.`
      : `Searched ${range}.`,
  );
  lines.push("", "Tips:");

  if (query && looksLikeTraceId(query)) {
    lines.push(
      `- "${query}" looks like a trace id. Free text never matches trace ids — use \`get_trace\` with traceId: "${query}".`,
    );
  }

  const wider = suggestWiderWindow({ spanMs });
  if (wider) {
    lines.push(
      `- Widen the window with startDate, e.g. startDate: "${wider}". Accepts h (hours), d (days), w (weeks), m (30-day months), or an ISO date.`,
    );
  }

  if (hasTraceIds) {
    lines.push(
      "- Retry with an earlier startDate, or relax the query and filters if you supplied them.",
      "- Looking up one full id? `get_trace` has no time window. A unique 8–31 character hex prefix searches the last 90 days.",
    );
  } else {
    lines.push(
      "- Looking up a known trace id? `get_trace` takes a traceId. A full id has no time window; a unique 8–31 character hex prefix searches the last 90 days.",
      "- To fetch several known trace ids at once, pass `traceIds` instead of `query`.",
    );
  }

  return lines.join("\n");
}

/**
 * Handles the search_traces MCP tool: searches with optional filters, text
 * query, trace ids and date range. Digest mode (default) returns AI-readable
 * digests per trace; json mode returns the full raw JSON.
 */
export async function handleSearchTraces(params: {
  query?: string;
  traceIds?: string[];
  filters?: Record<string, string[]>;
  filter?: string;
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  scrollId?: string;
  format?: "digest" | "json";
}): Promise<string> {
  const now = Date.now();
  const hasTraceIds = (params.traceIds?.length ?? 0) > 0;
  const defaultSpanMs = hasTraceIds ? ID_LOOKUP_WINDOW_MS : TEXT_SEARCH_WINDOW_MS;

  const endDate =
    params.endDate !== undefined ? parseRelativeDate(params.endDate) : now;
  const startDate = params.startDate !== undefined
    ? parseRelativeDate(params.startDate)
    : endDate - defaultSpanMs;

  if (startDate >= endDate) {
    throw new Error(
      `Invalid trace search window: startDate (${new Date(startDate).toISOString()}) must be before endDate (${new Date(endDate).toISOString()}).`,
    );
  }
  const format = params.format ?? "digest";

  const result = await apiSearchTraces({
    query: params.query,
    traceIds: params.traceIds,
    filters: params.filters,
    // Forwarded as itself: the filter language and the free-text query are two
    // different searches, and the server combines them.
    ...(params.filter ? { filter: params.filter } : {}),
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
      traceIds: params.traceIds,
      spanMs: endDate - startDate,
      windowWasDefaulted: params.startDate === undefined,
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
    lines.push(...traceLines(trace));
  }

  if (result.pagination?.scrollId) {
    lines.push(
      `\n**More results available.** Use scrollId: "${result.pagination.scrollId}" to get next page.`,
    );
  }

  lines.push(
    '\n> Tip: Use `get_trace` with a traceId for full details. Use `search_traces` with `format: "json"` for raw data. Use `discover_schema` to see available filter fields.',
  );

  return lines.join("\n");
}
