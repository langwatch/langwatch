import { searchTraces as apiSearchTraces, type TraceSearchResult } from "../langwatch-api.js";
import { parseRelativeDate } from "../utils/date-parsing.js";
import { formatEvaluationLines } from "../utils/format-evaluations.js";

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

/**
 * Handles the search_traces MCP tool: searches with optional filters,
 * text query and date range. Digest mode (default) returns AI-readable
 * digests per trace; json mode returns the full raw JSON.
 */
export async function handleSearchTraces(params: {
  query?: string;
  filters?: Record<string, string[]>;
  filter?: string;
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  scrollId?: string;
  format?: "digest" | "json";
}): Promise<string> {
  const now = Date.now();
  const startDate = params.startDate ? parseRelativeDate(params.startDate) : now - 86400000;
  const endDate = params.endDate ? parseRelativeDate(params.endDate) : now;
  const format = params.format ?? "digest";

  const result = await apiSearchTraces({
    query: params.query,
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
    return "No traces found matching your query.";
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
    '\n> Tip: Use `get_trace` with a trace_id for full details. Use `search_traces` with `format: "json"` for raw data. Use `discover_schema` to see available filter fields.',
  );

  return lines.join("\n");
}
