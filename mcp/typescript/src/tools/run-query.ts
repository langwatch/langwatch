/**
 * Handles the `run_query` MCP tool invocation.
 *
 * Runs one LangWatchQL statement and renders the result as a markdown table.
 * The row cap is what makes this a tool rather than a pipe: a statement that
 * forgot to aggregate can return ten thousand rows, and pasting those into a
 * conversation costs more context than the answer is worth. The cap is
 * announced rather than silent, so a reader can tell a capped result from a
 * complete one and aggregate further.
 *
 * @see specs/mcp-server/schema-discovery.feature
 */

import { runQuery } from "../langwatch-api-query.js";
import { markdownTable } from "../utils/markdown-table.js";

/** Rows the table prints. Beyond this, aggregate or export through the CLI. */
export const RUN_QUERY_ROW_CAP = 50;

export async function handleRunQuery(params: {
  sql: string;
  parameters?: Record<string, string | number | boolean | null>;
}): Promise<string> {
  const result = await runQuery(params);
  const headers = result.columns.map((column) => column.name);
  const shown = result.rows.slice(0, RUN_QUERY_ROW_CAP);

  const lines: string[] = [];
  lines.push(
    markdownTable({
      headers,
      rows: shown,
      emptyMessage: "The statement ran and returned no rows.",
    }),
  );
  lines.push("");
  lines.push(
    `Returned ${result.rows.length} row${result.rows.length === 1 ? "" : "s"} in ${result.statistics.elapsedMs}ms.`,
  );
  if (result.rows.length > shown.length) {
    lines.push(
      `Showing the first ${shown.length}. Aggregate further, or export every row with \`langwatch query "<statement>" --format jsonl\`.`,
    );
  }
  if (result.truncated) {
    lines.push(
      "The result hit a response ceiling and was cut short, so this is not the whole answer.",
    );
  }
  for (const diagnostic of result.diagnostics) {
    lines.push(`${diagnostic.code}: ${diagnostic.message}`);
  }
  return lines.join("\n");
}
