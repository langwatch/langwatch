/**
 * Handles the `run_query` MCP tool: one LangWatchQL statement rendered as a markdown table. Rows
 * are capped, and the cap is announced, so an unaggregated query cannot flood the conversation.
 * @see specs/mcp-server/schema-discovery.feature
 */

import { runQuery } from "../langwatch-api-query.ts";
import { LangWatchApiError } from "../langwatch-api.ts";
import { markdownTable } from "../utils/markdown-table.ts";

/** Rows the table prints. Beyond this, aggregate or export through the CLI. */
export const RUN_QUERY_ROW_CAP = 50;

/** What the tool tells an agent whose key names no project (the platform's `projects_required`). */
const PROJECTS_REQUIRED_MESSAGE =
  'Name the projects to query: pass `projects`, a list of project ids, or "all"';

export async function handleRunQuery(params: {
  sql: string;
  parameters?: Record<string, string | number | boolean | null>;
  projects?: string[] | string;
  sources?: string[];
}): Promise<string> {
  const result = await runQuery(params).catch((error: unknown) => {
    if (error instanceof LangWatchApiError && error.code === "projects_required") {
      throw new Error(PROJECTS_REQUIRED_MESSAGE);
    }
    throw error;
  });
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
  if (result.params) lines.push("", describeParams(result.params));
  return lines.join("\n");
}

/** What the run was bound to: every placeholder the SQL declares, by its SQL name. */
function describeParams(
  params: NonNullable<Awaited<ReturnType<typeof runQuery>>["params"]>,
): string {
  return ["Ran with these placeholders:", "```json", JSON.stringify(params, null, 2), "```"].join(
    "\n",
  );
}
