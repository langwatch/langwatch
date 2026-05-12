import { deleteDataset as apiDeleteDataset } from "../langwatch-api-datasets.js";

/**
 * Handles the platform_delete_dataset MCP tool invocation.
 *
 * Archives (soft-deletes) a dataset and returns confirmation.
 */
export async function handleDeleteDataset(params: {
  slugOrId: string;
}): Promise<string> {
  await apiDeleteDataset(params.slugOrId);

  const lines: string[] = [];
  lines.push("Dataset deleted successfully!\n");
  lines.push(
    "> The dataset has been archived and will no longer appear in listings.",
  );

  return lines.join("\n");
}
