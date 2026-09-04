import { archiveTestSuite as apiArchiveTestSuite } from "../langwatch-api-test-suites.js";

/**
 * Handles the platform_archive_test_suite MCP tool invocation.
 */
export async function handleArchiveTestSuite(params: {
  id: string;
}): Promise<string> {
  const result = await apiArchiveTestSuite(params.id);

  return `Test suite ${result.id} is archived, and the scenarios filed in it are archived with it.`;
}
