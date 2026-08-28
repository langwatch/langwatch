import { createTestSuite as apiCreateTestSuite } from "../langwatch-api-test-suites.js";

/**
 * Handles the platform_create_test_suite MCP tool invocation.
 */
export async function handleCreateTestSuite(params: {
  name: string;
}): Promise<string> {
  const suite = await apiCreateTestSuite({ name: params.name });

  return [
    `Test suite "${suite.name}" created.`,
    "",
    `**ID**: ${suite.id}`,
    `**Slug**: ${suite.slug}`,
    `**View**: ${suite.platformUrl}`,
    "",
    `> File scenarios in it with \`platform_create_scenario\` or \`platform_update_scenario\`, passing testSuiteId \`${suite.id}\`.`,
  ].join("\n");
}
