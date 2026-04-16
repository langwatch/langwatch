import { archiveTraces as apiArchiveTraces } from "../langwatch-api.js";

/**
 * Handles the archive_traces MCP tool invocation.
 *
 * Archives one or more traces by ID. Archived traces are excluded from
 * all query results but the underlying data is not deleted.
 */
export async function handleArchiveTraces(params: {
  traceIds: string[];
}): Promise<string> {
  const result = await apiArchiveTraces(params.traceIds);

  const lines: string[] = [];
  lines.push(`Successfully archived ${result.archived} trace(s).`);
  lines.push("");
  lines.push("Archived trace IDs:");
  for (const id of params.traceIds) {
    lines.push(`  - ${id}`);
  }
  lines.push("");
  lines.push(
    "Archived traces are excluded from search results and other queries. The data is not deleted."
  );

  return lines.join("\n");
}
