import { updateDatasetRecord as apiUpdateDatasetRecord } from "../langwatch-api-datasets.js";

/**
 * Handles the platform_update_dataset_record MCP tool invocation.
 *
 * Updates a single record in a dataset and returns confirmation.
 */
export async function handleUpdateDatasetRecord(params: {
  slugOrId: string;
  recordId: string;
  entry: Record<string, unknown>;
}): Promise<string> {
  const result = await apiUpdateDatasetRecord(params);

  const lines: string[] = [];
  lines.push("Record updated successfully!\n");
  lines.push(`**Record ID**: ${result.id}`);
  lines.push(`**Entry**: ${JSON.stringify(result.entry)}`);

  return lines.join("\n");
}
