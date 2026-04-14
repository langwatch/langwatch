import { archiveSuite as apiArchiveSuite } from "../langwatch-api-suites.js";

/**
 * Handles the platform_archive_suite MCP tool invocation.
 */
export async function handleArchiveSuite(params: {
  id: string;
}): Promise<string> {
  const result = await apiArchiveSuite(params.id);

  return `Suite ${result.id} has been archived (soft-deleted).`;
}
