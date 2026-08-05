import { deleteEvaluator as apiDeleteEvaluator } from "../langwatch-api-evaluators.js";

/**
 * Handles the platform_delete_evaluator MCP tool invocation.
 */
export async function handleDeleteEvaluator(params: {
  idOrSlug: string;
}): Promise<string> {
  const result = await apiDeleteEvaluator(params.idOrSlug);

  return `Evaluator ${result.id} has been archived (soft-deleted).`;
}
