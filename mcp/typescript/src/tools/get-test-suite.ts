import { getTestSuite as apiGetTestSuite } from "../langwatch-api-test-suites.js";

/**
 * Handles the platform_get_test_suite MCP tool invocation.
 */
export async function handleGetTestSuite(params: {
  id: string;
  format?: "digest" | "json";
}): Promise<string> {
  const suite = await apiGetTestSuite(params.id);

  if (params.format === "json") {
    return JSON.stringify(suite, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Test Suite: ${suite.name}\n`);
  lines.push(`**ID**: ${suite.id}`);
  lines.push(`**Slug**: ${suite.slug}`);
  lines.push(`**Scenarios**: ${suite.scenarioCount}`);
  if (suite.archivedAt) {
    lines.push(`**Archived**: ${suite.archivedAt}`);
  }
  lines.push(`**Created**: ${suite.createdAt}`);
  lines.push(`**Updated**: ${suite.updatedAt}`);

  lines.push("\n## Scenarios");
  if (suite.scenarios.length === 0) {
    lines.push("None filed yet.");
  } else {
    for (const scenario of suite.scenarios) {
      lines.push(`- ${scenario.name} (${scenario.id})`);
    }
  }

  lines.push(`\n**View**: ${suite.platformUrl}`);
  lines.push(
    "\n> Use `platform_run_test_suite` to run every scenario of this suite against a target.",
  );

  return lines.join("\n");
}
