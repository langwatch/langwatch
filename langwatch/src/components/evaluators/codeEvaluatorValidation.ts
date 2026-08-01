/**
 * Why the code evaluator's Create/Save button is disabled, phrased for the
 * author so a disabled button is never a silent dead end. Returns null when
 * every requirement is met (the button is enabled and needs no explanation).
 * Transient states (saving, loading the evaluator) are the caller's concern;
 * this only covers the user-fixable requirements.
 */
export function codeEvaluatorDisabledReason({
  hasName,
  hasCode,
  hasInput,
  isEditing,
}: {
  hasName: boolean;
  hasCode: boolean;
  hasInput: boolean;
  isEditing: boolean;
}): string | null {
  const missing: string[] = [];
  if (!hasName) missing.push("a name");
  if (!hasCode) missing.push("some code");
  if (!hasInput) missing.push("at least one input");

  if (missing.length === 0) return null;

  const action = isEditing ? "save your changes" : "create the evaluator";
  return `Add ${joinWithAnd(missing)} to ${action}.`;
}

/** "a, b, and c" with an Oxford comma; "a and b" for two; "a" for one. */
function joinWithAnd(items: string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
