import { archiveTraces as apiArchiveTraces } from "../langwatch-api.js";

/**
 * Handles the archive_traces MCP tool invocation.
 *
 * Dispatches archive commands through the event-sourcing pipeline for one or
 * more trace IDs. Archival is applied asynchronously by the trace_summaries
 * fold projection; archived traces are excluded from query results but the
 * underlying data is not deleted.
 */
export async function handleArchiveTraces(params: {
  traceIds: string[];
}): Promise<string> {
  const result = await apiArchiveTraces(params.traceIds);

  const lines: string[] = [];
  lines.push(
    `Dispatched ${result.dispatched} archive command(s) to the event-sourcing pipeline.`,
  );
  lines.push("");
  lines.push("Trace IDs:");
  for (const id of params.traceIds) {
    lines.push(`  - ${id}`);
  }
  lines.push("");
  lines.push(
    "Archival is applied asynchronously. Archived traces are excluded from search results and other queries once the projection processes the event. The underlying data is not deleted.",
  );

  return lines.join("\n");
}
