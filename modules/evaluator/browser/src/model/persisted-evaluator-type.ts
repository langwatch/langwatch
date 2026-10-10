/**
 * Workflow and code evaluators already exist as rows with their own editors;
 * the shared editor can only rename them or hand them on by id. A built-in
 * evaluator is configured from settings the shared editor owns.
 */
export function isPersistedEvaluatorType(type: string | undefined): boolean {
  return type === "workflow" || type === "code";
}
