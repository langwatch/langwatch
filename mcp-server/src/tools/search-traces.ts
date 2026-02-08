import { searchTraces as apiSearchTraces } from "../langwatch-api.js";
import { parseRelativeDate } from "../utils/date-parsing.js";

/**
 * Handles the search_traces MCP tool invocation.
 *
 * Searches LangWatch traces with optional filters, text query, and date range.
 * In digest mode (default), returns AI-readable formatted digests per trace.
 * In json mode, returns the full raw JSON.
 */
export async function handleSearchTraces(params: {
  query?: string;
  filters?: Record<string, string[]>;
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  scrollId?: string;
  format?: "digest" | "json";
}): Promise<string> {
  const now = Date.now();
  const startDate = params.startDate
    ? parseRelativeDate(params.startDate)
    : now - 86400000;
  const endDate = params.endDate ? parseRelativeDate(params.endDate) : now;
  const format = params.format ?? "digest";

  const result = await apiSearchTraces({
    query: params.query,
    filters: params.filters,
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
  lines.push(
    `Found ${result.pagination?.totalHits ?? traces.length} traces:\n`
  );

  for (const trace of traces) {
    lines.push(`### Trace: ${trace.trace_id}`);

    if (trace.formatted_trace) {
      lines.push(trace.formatted_trace);
    } else {
      const inputStr = trace.input?.value
        ? String(trace.input.value)
        : "N/A";
      const outputStr = trace.output?.value
        ? String(trace.output.value)
        : "N/A";
      lines.push(
        `- **Input**: ${inputStr.slice(0, 100)}${inputStr.length > 100 ? "..." : ""}`
      );
      lines.push(
        `- **Output**: ${outputStr.slice(0, 100)}${outputStr.length > 100 ? "..." : ""}`
      );
    }

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
    '\n> Tip: Use `get_trace` with a trace_id for full details. Use `search_traces` with `format: "json"` for raw data. Use `discover_schema` to see available filter fields.'
  );

  return lines.join("\n");
}
