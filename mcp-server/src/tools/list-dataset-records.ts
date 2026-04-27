import {
  listDatasetRecords as apiListDatasetRecords,
} from "../langwatch-api-datasets.js";
import { escapeMarkdown } from "../utils/escape-markdown.js";

/**
 * Handles the platform_list_dataset_records MCP tool invocation.
 *
 * Lists records in a dataset with pagination support.
 */
export async function handleListDatasetRecords(params: {
  slugOrId: string;
  page?: number;
  limit?: number;
  format?: "digest" | "json";
}): Promise<string> {
  const response = await apiListDatasetRecords({
    slugOrId: params.slugOrId,
    page: params.page,
    limit: params.limit,
  });

  if (params.format === "json") {
    return JSON.stringify(response, null, 2);
  }

  const { data: records, pagination } = response;

  if (records.length === 0) {
    return "No records found in this dataset.";
  }

  const lines: string[] = [];
  lines.push(`# Records (page ${pagination.page} of ${pagination.totalPages}, ${pagination.total} total)\n`);

  for (const record of records) {
    lines.push(`**${escapeMarkdown(record.id)}**: ${escapeMarkdown(JSON.stringify(record.entry))}`);
  }

  if (pagination.page < pagination.totalPages) {
    lines.push("");
    lines.push(`> Use \`platform_list_dataset_records\` with \`page: ${pagination.page + 1}\` to see the next page.`);
  }

  return lines.join("\n");
}
