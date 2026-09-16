import type { DatasetMutationResponse } from "../langwatch-api-datasets.js";
import { escapeMarkdown } from "../utils/escape-markdown.js";

/**
 * Formats the common detail lines (name, slug, id, column types) for a
 * dataset mutation response, shared by create-dataset and update-dataset.
 */
export function formatDatasetMutationDetails(result: DatasetMutationResponse): string[] {
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
