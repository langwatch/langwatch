import { updateDataset as apiUpdateDataset } from "../langwatch-api-datasets.js";
import type { DatasetColumnType } from "../langwatch-api-datasets.js";

/**
 * Handles the platform_update_dataset MCP tool invocation.
 *
 * Updates an existing dataset and returns a confirmation
 * with the updated details.
 */
export async function handleUpdateDataset(params: {
  slugOrId: string;
  name?: string;
  columnTypes?: DatasetColumnType[];
}): Promise<string> {
  const result = await apiUpdateDataset(params);

  const lines: string[] = [];
  lines.push("Dataset updated successfully!\n");
  lines.push(`**Name**: ${result.name}`);
  lines.push(`**Slug**: ${result.slug}`);
  lines.push(`**ID**: ${result.id}`);
  if (Array.isArray(result.columnTypes) && result.columnTypes.length > 0) {
    const colNames = result.columnTypes.map((c) => `${c.name} (${c.type})`).join(", ");
    lines.push(`**Columns**: ${colNames}`);
  }

  return lines.join("\n");
}
