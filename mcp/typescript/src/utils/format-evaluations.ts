export interface EvaluationSummary {
  evaluator_id?: string;
  name?: string;
  score?: number;
  passed?: boolean;
  label?: string;
}

/** Formats a trace's evaluation results as markdown bullet lines, one per evaluation. */
export function formatEvaluationLines(evaluations: EvaluationSummary[]): string[] {
  return evaluations.map((evaluation) => {
    const status =
      evaluation.passed === true
        ? "PASSED"
        : evaluation.passed === false
          ? "FAILED"
          : "N/A";
    return `- **${evaluation.name || evaluation.evaluator_id}**: ${status}${evaluation.score != null ? ` (score: ${evaluation.score})` : ""}${evaluation.label ? ` [${evaluation.label}]` : ""}`;
  });
}
