import { createTestSuite as apiCreateTestSuite } from "../langwatch-api-test-suites.js";
import {
  type EvaluatorAttachmentInput,
  type SuiteField,
  toWireAttachments,
} from "../schemas/suite-fields.js";
import {
  formatEvaluatorAttachments,
  formatSuiteFields,
} from "./format-suite-details.js";

/**
 * Handles the platform_create_test_suite MCP tool invocation.
 */
export async function handleCreateTestSuite(params: {
  name: string;
  fields?: SuiteField[];
  evaluators?: EvaluatorAttachmentInput[];
}): Promise<string> {
  const suite = await apiCreateTestSuite({
    name: params.name,
    ...(params.fields !== undefined ? { fields: params.fields } : {}),
    ...(params.evaluators !== undefined
      ? { evaluators: toWireAttachments(params.evaluators) }
      : {}),
  });

  return [
    `Test suite "${suite.name}" created.`,
    "",
    `**ID**: ${suite.id}`,
    `**Slug**: ${suite.slug}`,
    `**View**: ${suite.platformUrl}`,
    ...formatSuiteFields(suite.fields),
    ...formatEvaluatorAttachments(suite.evaluators),
    "",
    `> File scenarios in it with \`platform_create_scenario\` or \`platform_update_scenario\`, passing testSuiteId \`${suite.id}\`${
      suite.fields && suite.fields.length > 0
        ? ` and a value per field under \`fields\``
        : ""
    }.`,
  ].join("\n");
}
