import {
  getDataset as apiGetDataset,
  type DatasetDetailResponse,
} from "../langwatch-api-datasets.js";
import { escapeMarkdown } from "../utils/escape-markdown.js";

/**
 * Formats a dataset detail response into AI-readable markdown.
 *
 * Exported for unit testing.
 */
export function formatDatasetResponse(
  dataset: DatasetDetailResponse,
): string {
  const lines: string[] = [];
  lines.push(`# Dataset: ${escapeMarkdown(dataset.name)}\n`);
  lines.push(`**Slug**: ${escapeMarkdown(dataset.slug)}`);
  lines.push(`**ID**: ${escapeMarkdown(dataset.id)}`);

  // Column table
  if (
    Array.isArray(dataset.columnTypes) &&
    dataset.columnTypes.length > 0
  ) {
    lines.push("\n## Columns\n");
    lines.push("| Name | Type |");
    lines.push("|------|------|");
    for (const col of dataset.columnTypes) {
      lines.push(`| ${escapeMarkdown(col.name)} | ${escapeMarkdown(col.type)} |`);
    }
  }

  // Record preview
  if (Array.isArray(dataset.data) && dataset.data.length > 0) {
    lines.push(`\n## Records (${dataset.data.length} shown)\n`);
    for (const record of dataset.data) {
      lines.push(`**${escapeMarkdown(record.id)}**: ${escapeMarkdown(JSON.stringify(record.entry))}`);
    }
  } else {
    lines.push("\nNo records in this dataset.");
  }

  return lines.join("\n");
}

/**
 * Handles the platform_get_dataset MCP tool invocation.
 *
 * Retrieves a specific dataset by slug or ID and formats it as
 * AI-readable markdown or raw JSON.
 */
export async function handleGetDataset(params: {
  slugOrId: string;
  format?: "digest" | "json";
}): Promise<string> {
  const dataset = await apiGetDataset(params.slugOrId);

  if (params.format === "json") {
    return JSON.stringify(dataset, null, 2);
  }

  return formatDatasetResponse(dataset);
}
