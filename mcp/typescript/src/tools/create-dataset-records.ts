import { createDatasetRecords as apiCreateDatasetRecords } from "../langwatch-api-datasets.js";

/**
 * Handles the platform_create_dataset_records MCP tool invocation.
 *
 * Creates records in a dataset in batch and returns a confirmation
 * with the count of records created.
 */
export async function handleCreateDatasetRecords(params: {
  slugOrId: string;
  entries: Record<string, unknown>[];
}): Promise<string> {
  const result = await apiCreateDatasetRecords(params);
  const count = Array.isArray(result.data) ? result.data.length : 0;

  const lines: string[] = [];
  lines.push(`${count} record(s) created successfully!\n`);
  lines.push(
    "> Use `platform_get_dataset` to see the updated dataset with all records.",
  );

  return lines.join("\n");
}
