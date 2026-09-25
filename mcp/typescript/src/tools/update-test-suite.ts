import { updateTestSuite as apiUpdateTestSuite } from "../langwatch-api-test-suites.js";
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
 * Handles the platform_update_test_suite MCP tool invocation.
 *
 * Any of the name, the fields and the evaluators. A field list or an
 * evaluator list replaces the one the suite holds; a key left out keeps
 * what the suite has.
 */
export async function handleUpdateTestSuite(params: {
  id: string;
  name?: string;
  fields?: SuiteField[];
  evaluators?: EvaluatorAttachmentInput[];
}): Promise<string> {
  const suite = await apiUpdateTestSuite({
    id: params.id,
    ...(params.name !== undefined ? { name: params.name } : {}),
    ...(params.fields !== undefined ? { fields: params.fields } : {}),
    ...(params.evaluators !== undefined
      ? { evaluators: toWireAttachments(params.evaluators) }
      : {}),
  });

  return [
    `Test suite "${suite.name}" updated.`,
    "",
    `**ID**: ${suite.id}`,
    `**Slug**: ${suite.slug}`,
    `**Scenarios**: ${suite.scenarioCount}`,
    ...formatSuiteFields(suite.fields),
    ...formatEvaluatorAttachments(suite.evaluators),
    "",
    `**View**: ${suite.platformUrl}`,
  ].join("\n");
}
