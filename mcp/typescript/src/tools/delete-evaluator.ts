import { deleteEvaluator as apiDeleteEvaluator } from "../langwatch-api-evaluators.ts";

/**
 * Handles the platform_delete_evaluator MCP tool invocation.
 */
export async function handleDeleteEvaluator(params: { idOrSlug: string }): Promise<string> {
  await apiDeleteEvaluator(params.idOrSlug);

  return `Evaluator ${params.idOrSlug} has been archived (soft-deleted).`;
}
