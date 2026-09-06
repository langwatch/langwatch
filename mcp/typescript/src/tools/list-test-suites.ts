import { listTestSuites as apiListTestSuites } from "../langwatch-api-test-suites.js";

/**
 * Handles the platform_list_test_suites MCP tool invocation.
 */
export async function handleListTestSuites(params: {
  format?: "digest" | "json";
}): Promise<string> {
  const suites = await apiListTestSuites();

  if (params.format === "json") {
    return JSON.stringify(suites, null, 2);
  }

  if (!Array.isArray(suites) || suites.length === 0) {
    return "No test suites found in this project.\n\n> Tip: Use `platform_create_test_suite` to create one, then file scenarios in it with `testSuiteId`.";
  }

  const lines: string[] = [];
  lines.push(`# Test Suites (${suites.length} total)\n`);

  for (const suite of suites) {
    lines.push(`## ${suite.name}${suite.archivedAt ? " (archived)" : ""}`);
    lines.push(`**ID**: ${suite.id}`);
    lines.push(`**Slug**: ${suite.slug}`);
    lines.push(`**Scenarios**: ${suite.scenarioCount}`);
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_test_suite` with the ID to read the scenarios, or `platform_run_test_suite` to run them against a target.",
  );

  return lines.join("\n");
}
