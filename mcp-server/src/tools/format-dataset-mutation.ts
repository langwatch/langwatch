import type { DatasetMutationResponse } from "../langwatch-api-datasets.js";

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
  lines.push(`**Name**: ${result.name}`);
  lines.push(`**Slug**: ${result.slug}`);
  lines.push(`**ID**: ${result.id}`);
  if (Array.isArray(result.columnTypes) && result.columnTypes.length > 0) {
    const colNames = result.columnTypes
      .map((c) => `${c.name} (${c.type})`)
      .join(", ");
    lines.push(`**Columns**: ${colNames}`);
  }
  return lines;
}
