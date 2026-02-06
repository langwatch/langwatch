import { searchTraces as apiSearchTraces } from "../langwatch-api.js";

function parseRelativeDate(input: string): number {
  const now = Date.now();
  const match = input.match(/^(\d+)(h|d|w|m)$/);
  if (!match) return Date.parse(input) || now;

  const [, amount, unit] = match;
  const ms: Record<string, number> = {
    h: 3600000,
    d: 86400000,
    w: 604800000,
    m: 2592000000,
  };
  return now - parseInt(amount!) * (ms[unit!] ?? 86400000);
}

/**
 * Handles the search_traces MCP tool invocation.
 *
 * Searches LangWatch traces with optional filters, text query, and date range.
 * Returns an AI-readable markdown summary of matching traces.
 */
export async function handleSearchTraces(params: {
  query?: string;
  filters?: Record<string, string[]>;
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  scrollId?: string;
}): Promise<string> {
  const now = Date.now();
  const startDate = params.startDate
    ? parseRelativeDate(params.startDate)
    : now - 86400000;
  const endDate = params.endDate ? parseRelativeDate(params.endDate) : now;

  const result = (await apiSearchTraces({
    query: params.query,
    filters: params.filters,
    startDate,
    endDate,
    pageSize: params.pageSize ?? 25,
    scrollId: params.scrollId,
  })) as any;

  const traces = result.traces || [];
  if (traces.length === 0) {
    return "No traces found matching your query.";
  }

  const lines: string[] = [];
  lines.push(
    `Found ${result.pagination?.totalHits ?? traces.length} traces:\n`
  );

  for (const trace of traces) {
    const input = trace.input?.value
      ? String(trace.input.value).slice(0, 100)
      : "N/A";
    const output = trace.output?.value
      ? String(trace.output.value).slice(0, 100)
      : "N/A";
    lines.push(`### Trace: ${trace.trace_id}`);
    lines.push(
      `- **Input**: ${input}${(trace.input?.value?.length ?? 0) > 100 ? "..." : ""}`
    );
    lines.push(
      `- **Output**: ${output}${(trace.output?.value?.length ?? 0) > 100 ? "..." : ""}`
    );
    if (trace.timestamps) {
      lines.push(`- **Time**: ${trace.timestamps.started_at || "N/A"}`);
    }
    if (trace.error) {
      lines.push(`- **Error**: ${JSON.stringify(trace.error)}`);
    }
    lines.push("");
  }

  if (result.pagination?.scrollId) {
    lines.push(
      `\n**More results available.** Use scrollId: "${result.pagination.scrollId}" to get next page.`
    );
  }

  lines.push(
    "\n> Tip: Use `get_trace` with a trace_id for full details. Use `discover_schema` to see available filter fields."
  );

  return lines.join("\n");
}
