import {
  DATASET_PREVIEW_MAX_BYTES,
  DATASET_PREVIEW_MAX_RECORDS,
  getDataset as apiGetDataset,
  type DatasetDetailResponse,
} from "../langwatch-api-datasets.ts";
import { escapeMarkdown } from "../utils/escape-markdown.ts";

/**
 * Formats a dataset detail response into AI-readable markdown.
 *
 * Exported for unit testing.
 */
export function formatDatasetResponse(dataset: DatasetDetailResponse): string {
  const lines: string[] = [];
  lines.push(`# Dataset: ${escapeMarkdown(dataset.name)}\n`);
  lines.push(`**Slug**: ${escapeMarkdown(dataset.slug)}`);
  lines.push(`**ID**: ${escapeMarkdown(dataset.id)}`);

  // Column table
  if (Array.isArray(dataset.columnTypes) && dataset.columnTypes.length > 0) {
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
      lines.push(
        `**${escapeMarkdown(record.id)}**: ${escapeMarkdown(JSON.stringify(record.entry))}`,
      );
    }
  } else if (!dataset.omittedRecords) {
    lines.push("\nNo records in this dataset.");
  }

  const note = omittedRecordsNote(dataset);
  if (note) lines.push(`\n${note}`);

  return lines.join("\n");
}

/**
 * Says how many records a preview leaves out and how to read them, or `undefined` when the
 * preview holds every record.
 */
export function omittedRecordsNote(dataset: DatasetDetailResponse): string | undefined {
  if (!dataset.omittedRecords) return undefined;

  const shown = Array.isArray(dataset.data) ? dataset.data.length : 0;
  const megabytes = DATASET_PREVIEW_MAX_BYTES / (1024 * 1024);
  return (
    `Showing ${shown} of ${dataset.totalRecords ?? shown + dataset.omittedRecords} records: ` +
    `${dataset.omittedRecords} are left out. A preview holds at most ` +
    `${DATASET_PREVIEW_MAX_RECORDS} records and ${megabytes} MB. ` +
    "Read the rest with platform_list_dataset_records, using its page and limit parameters."
  );
}

/**
 * Handles the platform_get_dataset MCP tool: retrieves a dataset by
 * slug or ID and formats it as AI-readable markdown or raw JSON.
 */
export async function handleGetDataset(params: {
  slugOrId: string;
  format?: "digest" | "json";
}): Promise<string> {
  const dataset = await apiGetDataset(params.slugOrId);

  if (params.format === "json") {
    const note = omittedRecordsNote(dataset);
    return JSON.stringify(note ? { ...dataset, note } : dataset, null, 2);
  }

  return formatDatasetResponse(dataset);
}
