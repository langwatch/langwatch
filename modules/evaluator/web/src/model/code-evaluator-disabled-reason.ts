export type CodeEvaluatorCompletion = {
  hasName: boolean;
  hasCode: boolean;
  hasInput: boolean;
  isEditing: boolean;
};

/**
 * Gives authors an actionable reason when a code evaluator cannot be saved.
 * Loading and mutation state remain the host application's responsibility.
 */
export function codeEvaluatorDisabledReason({
  hasName,
  hasCode,
  hasInput,
  isEditing,
}: CodeEvaluatorCompletion): string | null {
  const missing: string[] = [];
  if (!hasName) missing.push("a name");
  if (!hasCode) missing.push("some code");
  if (!hasInput) missing.push("at least one input");

  if (missing.length === 0) return null;

  const action = isEditing ? "save your changes" : "create the evaluator";
  return `Add ${joinWithAnd(missing)} to ${action}.`;
}

function joinWithAnd(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
