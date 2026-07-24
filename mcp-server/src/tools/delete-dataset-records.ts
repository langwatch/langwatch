import { deleteDatasetRecords as apiDeleteDatasetRecords } from "../langwatch-api-datasets.js";

/**
 * Handles the platform_delete_dataset_records MCP tool invocation.
 *
 * Deletes records from a dataset by IDs and returns confirmation
 * with the count of records deleted.
 */
export async function handleDeleteDatasetRecords(params: {
  slugOrId: string;
  recordIds: string[];
}): Promise<string> {
  const result = await apiDeleteDatasetRecords(params);

  const lines: string[] = [];
  lines.push(`${result.deletedCount} record(s) deleted successfully!\n`);
  lines.push(
    "> Use `platform_get_dataset` to see the updated dataset.",
  );

  return lines.join("\n");
}
