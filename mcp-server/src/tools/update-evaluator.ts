import {
  updateEvaluator as apiUpdateEvaluator,
  getEvaluatorType,
} from "../langwatch-api-evaluators.js";

/**
 * Handles the platform_update_evaluator MCP tool invocation.
 *
 * Updates an existing evaluator and returns a confirmation
 * with the updated details.
 */
export async function handleUpdateEvaluator(params: {
  evaluatorId: string;
  name?: string;
  config?: Record<string, unknown>;
}): Promise<string> {
  const { evaluatorId, ...data } = params;
  const result = await apiUpdateEvaluator({ id: evaluatorId, ...data });

  const evaluatorType = getEvaluatorType(result);

  const lines: string[] = [];
  lines.push("Evaluator updated successfully!\n");
  lines.push(`**ID**: ${result.id}`);
  if (result.slug) lines.push(`**Slug**: ${result.slug}`);
  lines.push(`**Name**: ${result.name}`);
  if (evaluatorType) lines.push(`**Evaluator Type**: ${evaluatorType}`);

  return lines.join("\n");
}
