import type { DatasetMutationResponse } from "../langwatch-api-datasets.js";
import { escapeMarkdown } from "../utils/escape-markdown.js";

/**
 * Formats the common detail lines for a dataset mutation response
 * (name, slug, id, and column types).
 *
 * Used by both create-dataset and update-dataset handlers to avoid
 * duplicating the formatting logic.
 */
export function formatDatasetMutationDetails(
  result: DatasetMutationResponse,
): string[] {
  const lines: string[] = [];
  lines.push(`**Name**: ${escapeMarkdown(result.name)}`);
  lines.push(`**Slug**: ${escapeMarkdown(result.slug)}`);
  lines.push(`**ID**: ${escapeMarkdown(result.id)}`);
  if (Array.isArray(result.columnTypes) && result.columnTypes.length > 0) {
    const colNames = result.columnTypes
      .map((c) => `${escapeMarkdown(c.name)} (${escapeMarkdown(c.type)})`)
      .join(", ");
    lines.push(`**Columns**: ${colNames}`);
  }
  return lines;
}
