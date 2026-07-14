import { AVAILABLE_EVALUATORS } from "../../../langevals/ts-integration/evaluators.generated.js";
import type { EvaluatorDefinition, EvaluatorTypes } from "../../../langevals/ts-integration/evaluators.generated.js";

/**
 * Formats evaluator schema information for the discover_schema tool.
 *
 * Two levels of detail:
 * - Overview (no evaluatorType): compact list of all evaluator types
 * - Detail (with evaluatorType): full schema for one evaluator type
 */
export function formatEvaluatorSchema(evaluatorType?: string): string {
  if (evaluatorType) {
    return formatEvaluatorDetail(evaluatorType);
  }
  return formatEvaluatorOverview();
}

/**
 * Returns a compact overview of all available evaluator types.
 * Shows type, name, category, and a one-line description.
 */
function formatEvaluatorOverview(): string {
  const lines: string[] = [];
  lines.push("# Available Evaluator Types\n");

  const byCategory = new Map<string, { type: string; name: string; description: string }[]>();

  for (const [type, def] of Object.entries(AVAILABLE_EVALUATORS)) {
    const evalDef = def as EvaluatorDefinition<EvaluatorTypes>;
    const oneLine = extractFirstLine(evalDef.description);
    const entry = { type, name: evalDef.name, description: oneLine };

    const list = byCategory.get(evalDef.category) ?? [];
    list.push(entry);
    byCategory.set(evalDef.category, list);
  }

  for (const [category, entries] of byCategory) {
    lines.push(`## ${category}\n`);
    for (const entry of entries) {
      lines.push(`- **${entry.type}** (${entry.name}): ${entry.description}`);
    }
    lines.push("");
  }

  lines.push(
    "> Use `discover_schema({ category: 'evaluators', evaluatorType: '<type>' })` for full details on a specific evaluator type.",
  );

  return lines.join("\n");
}

/**
 * Returns the full schema for a specific evaluator type.
 * Includes settings with descriptions and defaults, required/optional fields, env vars, and result fields.
 */
function formatEvaluatorDetail(evaluatorType: string): string {
  const def = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes] as
    | EvaluatorDefinition<EvaluatorTypes>
    | undefined;

  if (!def) {
    return `Unknown evaluator type: "${evaluatorType}". Use \`discover_schema({ category: 'evaluators' })\` to see all available types.`;
  }

  const lines: string[] = [];
  lines.push(`# ${def.name} (\`${evaluatorType}\`)\n`);
  lines.push(`**Category**: ${def.category}`);
  lines.push(`**Is Guardrail**: ${def.isGuardrail ? "Yes" : "No"}`);
  if (def.docsUrl) {
    lines.push(`**Docs**: ${def.docsUrl}`);
  }
  lines.push("");
  lines.push(`## Description\n`);
  lines.push(def.description.trim());

  // Required and optional fields
  lines.push("\n## Fields\n");
  if (def.requiredFields.length > 0) {
    lines.push(`**Required**: ${def.requiredFields.join(", ")}`);
  } else {
    lines.push("**Required**: none");
  }
  if (def.optionalFields.length > 0) {
    lines.push(`**Optional**: ${def.optionalFields.join(", ")}`);
  }

  // Settings
  const settingsEntries = Object.entries(def.settings);
  if (settingsEntries.length > 0) {
    lines.push("\n## Settings\n");
    for (const [key, setting] of settingsEntries) {
      const s = setting as { description?: string; default: unknown };
      const defaultStr = JSON.stringify(s.default);
      const desc = s.description ? ` - ${s.description}` : "";
      lines.push(`- **${key}**${desc}`);
      lines.push(`  Default: \`${defaultStr}\``);
    }
  }

  // Env vars
  if (def.envVars.length > 0) {
    lines.push("\n## Required Environment Variables\n");
    for (const envVar of def.envVars) {
      lines.push(`- \`${envVar}\``);
    }
  }

  // Result fields
  const resultEntries = Object.entries(def.result);
  if (resultEntries.length > 0) {
    lines.push("\n## Result Fields\n");
    for (const [key, value] of resultEntries) {
      const v = value as { description: string };
      lines.push(`- **${key}**: ${v.description}`);
    }
  }

  lines.push("\n## Usage Example\n");
  lines.push("```json");
  lines.push(JSON.stringify({
    evaluatorType: evaluatorType,
    settings: Object.fromEntries(
      settingsEntries.map(([key, setting]) => [key, (setting as { default: unknown }).default]),
    ),
  }, null, 2));
  lines.push("```");

  return lines.join("\n");
}

/**
 * Extracts the first meaningful line from a multi-line description.
 */
function extractFirstLine(description: string): string {
  const trimmed = description.trim();
  const firstLine = trimmed.split("\n")[0]?.trim() ?? trimmed;
  // Limit to a reasonable length
  if (firstLine.length > 120) {
    return firstLine.slice(0, 117) + "...";
  }
  return firstLine;
}
