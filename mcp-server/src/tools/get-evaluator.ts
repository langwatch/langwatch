import {
  getEvaluator as apiGetEvaluator,
  getEvaluatorType,
} from "../langwatch-api-evaluators.js";

/**
 * Handles the platform_get_evaluator MCP tool invocation.
 *
 * Retrieves a specific evaluator by ID or slug and formats it as
 * AI-readable markdown.
 */
export async function handleGetEvaluator(params: {
  idOrSlug: string;
}): Promise<string> {
  const evaluator = await apiGetEvaluator(params.idOrSlug);

  const evaluatorType = getEvaluatorType(evaluator);

  const lines: string[] = [];
  lines.push(`# Evaluator: ${evaluator.name}\n`);
  lines.push(`**ID**: ${evaluator.id}`);
  if (evaluator.slug) lines.push(`**Slug**: ${evaluator.slug}`);
  lines.push(`**Kind**: ${evaluator.type}`);
  if (evaluatorType) lines.push(`**Evaluator Type**: ${evaluatorType}`);

  if (evaluator.config) {
    lines.push("\n## Config");
    lines.push("```json");
    lines.push(JSON.stringify(evaluator.config, null, 2));
    lines.push("```");
  }

  if (Array.isArray(evaluator.fields) && evaluator.fields.length > 0) {
    lines.push("\n## Input Fields");
    for (const field of evaluator.fields) {
      const opt = field.optional ? " (optional)" : "";
      lines.push(`- **${field.identifier}** (${field.type})${opt}`);
    }
  }

  if (Array.isArray(evaluator.outputFields) && evaluator.outputFields.length > 0) {
    lines.push("\n## Output Fields");
    for (const field of evaluator.outputFields) {
      lines.push(`- **${field.identifier}** (${field.type})`);
    }
  }

  if (evaluator.workflowName) {
    lines.push(`\n**Workflow**: ${evaluator.workflowName}`);
  }

  return lines.join("\n");
}
