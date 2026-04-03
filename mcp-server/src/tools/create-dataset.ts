import { createDataset as apiCreateDataset } from "../langwatch-api-datasets.js";
import type { DatasetColumnType } from "../langwatch-api-datasets.js";

/**
 * Handles the platform_create_dataset MCP tool invocation.
 *
 * Creates a new dataset in the LangWatch project and returns a
 * confirmation with the created dataset's details.
 */
export async function handleCreateDataset(params: {
  name: string;
  columnTypes?: DatasetColumnType[];
}): Promise<string> {
  const result = await apiCreateDataset(params);

  const lines: string[] = [];
  lines.push("Dataset created successfully!\n");
  lines.push(`**Name**: ${result.name}`);
  lines.push(`**Slug**: ${result.slug}`);
  lines.push(`**ID**: ${result.id}`);
  if (Array.isArray(result.columnTypes) && result.columnTypes.length > 0) {
    const colNames = result.columnTypes.map((c) => `${c.name} (${c.type})`).join(", ");
    lines.push(`**Columns**: ${colNames}`);
  }

  return lines.join("\n");
}
