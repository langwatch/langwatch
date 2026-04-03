import { updateDataset as apiUpdateDataset } from "../langwatch-api-datasets.js";
import type { DatasetColumnType } from "../langwatch-api-datasets.js";
import { formatDatasetMutationDetails } from "./format-dataset-mutation.js";

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
  lines.push(...formatDatasetMutationDetails(result));

  return lines.join("\n");
}
