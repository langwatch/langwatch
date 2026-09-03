import { renameTestSuite as apiRenameTestSuite } from "../langwatch-api-test-suites.js";

/**
 * Handles the platform_rename_test_suite MCP tool invocation.
 */
export async function handleRenameTestSuite(params: { id: string; name: string }): Promise<string> {
  const suite = await apiRenameTestSuite(params);

  return [
    `Test suite ${suite.id} is now named "${suite.name}".`,
    "",
    `**Slug**: ${suite.slug}`,
    `**Scenarios**: ${suite.scenarioCount}`,
  ].join("\n");
}
