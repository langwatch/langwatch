import {
  createEvaluator as apiCreateEvaluator,
  getEvaluatorType,
} from "../langwatch-api-evaluators.js";

/**
 * Handles the platform_create_evaluator MCP tool invocation.
 *
 * Creates a new evaluator in the LangWatch project and returns a
 * confirmation with the created evaluator's details.
 */
export async function handleCreateEvaluator(params: {
  name: string;
  config: Record<string, unknown>;
}): Promise<string> {
  const result = await apiCreateEvaluator(params);

  const evaluatorType = getEvaluatorType(result);

  const lines: string[] = [];
  lines.push("Evaluator created successfully!\n");
  lines.push(`**ID**: ${result.id}`);
  if (result.slug) lines.push(`**Slug**: ${result.slug}`);
  lines.push(`**Name**: ${result.name}`);
  if (evaluatorType) lines.push(`**Evaluator Type**: ${evaluatorType}`);
  lines.push(`**Kind**: ${result.type}`);

  if (Array.isArray(result.fields) && result.fields.length > 0) {
    lines.push(`**Input Fields**: ${result.fields.map((f) => f.identifier).join(", ")}`);
  }

  return lines.join("\n");
}
