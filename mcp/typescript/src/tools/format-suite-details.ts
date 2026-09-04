import type {
  EvaluatorAttachmentWire,
  ScenarioMapping,
  SuiteField,
} from "../schemas/suite-fields.js";

/**
 * The digest lines for a suite's fields, the evaluators attached to a suite
 * or a plan, and the evaluator results on a finished run. Shared by every
 * tool that prints one of them.
 */

/** A mapping as one short path: `scenario.fields.golden_sql` or `"literal"`. */
export function describeMapping(mapping: ScenarioMapping): string {
  return mapping.type === "value"
    ? JSON.stringify(mapping.value)
    : `${mapping.sourceId}.${mapping.path.join(".")}`;
}

export function formatSuiteFields(fields: SuiteField[] | undefined): string[] {
  if (!fields || fields.length === 0) return [];
  return [
    "\n## Fields",
    ...fields.map((field) => `- ${field.identifier} (${field.type})`),
  ];
}

export function formatEvaluatorAttachments(
  evaluators: EvaluatorAttachmentWire[] | undefined,
): string[] {
  if (!evaluators || evaluators.length === 0) return [];
  const lines = ["\n## Evaluators"];
  for (const attachment of evaluators) {
    const gate = attachment.required ? "required" : "reports only";
    lines.push(`- ${attachment.evaluatorId} (${gate}, attachment ${attachment.id})`);
    for (const [input, mapping] of Object.entries(attachment.mappings)) {
      lines.push(`  - ${input}: ${describeMapping(mapping)}`);
    }
  }
  return lines;
}

/** One evaluator's result on a finished run. */
export interface SimulationRunEvaluation {
  evaluatorId: string;
  name: string;
  status: "passed" | "failed" | "scored" | "skipped" | "error";
  required: boolean;
  passed?: boolean;
  score?: number;
  label?: string;
  details?: string;
}

export function formatEvaluations(
  evaluations: SimulationRunEvaluation[] | undefined,
): string[] {
  if (!evaluations || evaluations.length === 0) return [];
  const lines = ["\n## Evaluators"];
  for (const evaluation of evaluations) {
    const parts: string[] = [evaluation.status];
    if (evaluation.score !== undefined) parts.push(`score ${evaluation.score}`);
    if (evaluation.label !== undefined) parts.push(evaluation.label);
    if (evaluation.required) parts.push("required");
    lines.push(`- **${evaluation.name}**: ${parts.join(", ")}`);
    if (evaluation.details) lines.push(`  ${evaluation.details}`);
  }
  return lines;
}
