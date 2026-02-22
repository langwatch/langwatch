import {
  listEvaluators as apiListEvaluators,
  getEvaluatorType,
} from "../langwatch-api-evaluators.js";

/**
 * Handles the platform_list_evaluators MCP tool invocation.
 *
 * Lists all evaluators in the LangWatch project, formatted as an
 * AI-readable digest.
 */
export async function handleListEvaluators(): Promise<string> {
  const evaluators = await apiListEvaluators();

  if (!Array.isArray(evaluators) || evaluators.length === 0) {
    return "No evaluators found in this project.\n\n> Tip: Use `platform_create_evaluator` to create your first evaluator. Call `discover_schema({ category: 'evaluators' })` to see available evaluator types.";
  }

  const lines: string[] = [];
  lines.push(`# Evaluators (${evaluators.length} total)\n`);

  for (const e of evaluators) {
    const evaluatorType = getEvaluatorType(e);
    lines.push(`## ${e.name}`);
    lines.push(`**ID**: ${e.id}`);
    if (e.slug) lines.push(`**Slug**: ${e.slug}`);
    if (evaluatorType) lines.push(`**Type**: ${evaluatorType}`);
    lines.push(`**Kind**: ${e.type}`);
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_evaluator` with the ID or slug to see full evaluator details.",
  );

  return lines.join("\n");
}
