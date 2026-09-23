/**
 * One markdown table renderer for caller-chosen columns. Cells are captured content, so they are
 * escaped: one pipe in a cell would split the row for every reader.
 */

import { escapeMarkdown } from "./escape-markdown.js";

/** Longest a single cell is rendered before it is cut. */
const MAX_CELL_LENGTH = 200;

/** One cell: escaped, flattened to a line, and bounded. */
export function markdownCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const escaped = escapeMarkdown(text);
  return escaped.length > MAX_CELL_LENGTH ? `${escaped.slice(0, MAX_CELL_LENGTH - 1)}…` : escaped;
}

/**
 * A markdown table, or a line saying there is nothing to show. `rows` are read by header, so a row
 * missing a key renders an empty cell rather than shifting every cell after it one column left.
 */
export function markdownTable({
  headers,
  rows,
  emptyMessage = "No rows.",
}: {
  headers: readonly string[];
  rows: readonly Record<string, unknown>[];
  emptyMessage?: string;
}): string {
  if (headers.length === 0 || rows.length === 0) return emptyMessage;
  const lines = [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${headers.map((header) => markdownCell(row[header])).join(" | ")} |`);
  }
  return lines.join("\n");
}
