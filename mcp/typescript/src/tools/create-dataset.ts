import { createDataset as apiCreateDataset } from "../langwatch-api-datasets.js";
import type { DatasetColumnType } from "../langwatch-api-datasets.js";
import { formatDatasetMutationDetails } from "./format-dataset-mutation.js";

/**
 * Handles the platform_create_dataset MCP tool: creates a dataset and
 * returns a confirmation with its details.
 */
export async function handleCreateDataset(params: {
  name: string;
  columnTypes?: DatasetColumnType[];
}): Promise<string> {
  const result = await apiCreateDataset(params);

  const lines: string[] = [];
  lines.push("Dataset created successfully!\n");
  lines.push(...formatDatasetMutationDetails(result));

  return lines.join("\n");
}
