/**
 * Pure grammar for dynamic per-evaluator eval column ids:
 */

export type EvalColumnField = "score" | "verdict" | "label";

const EVAL_COLUMN_PREFIX = "eval:";

export const EVAL_FIELD_LABELS: Record<EvalColumnField, string> = {
  score: "Score",
  verdict: "Verdict",
  label: "Label",
};

/** Order the field selector and any field-iterating UI render in. */
export const EVAL_COLUMN_FIELDS: readonly EvalColumnField[] = ["score", "verdict", "label"];

export interface ParsedEvalColumnId {
  field: EvalColumnField;
  /** Evaluator id or free-text key — everything after `eval:<field>:`. */
  evaluatorKey: string;
}

export function isEvalColumnId(id: string): boolean {
  return id.startsWith(EVAL_COLUMN_PREFIX);
}

export function formatEvalColumnId({
  field,
  evaluatorKey,
}: {
  field: EvalColumnField;
  evaluatorKey: string;
}): string {
  return `${EVAL_COLUMN_PREFIX}${field}:${evaluatorKey}`;
}

function isEvalColumnField(value: string): value is EvalColumnField {
  // Own-key check — `in` would let inherited keys (toString, constructor…)
  // pass and parse as a bogus field.
  return Object.hasOwn(EVAL_FIELD_LABELS, value);
}

export function parseEvalColumnId(id: string): ParsedEvalColumnId | null {
  if (!isEvalColumnId(id)) return null;
  const rest = id.slice(EVAL_COLUMN_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const field = rest.slice(0, sep);
  const evaluatorKey = rest.slice(sep + 1);
  if (!isEvalColumnField(field) || evaluatorKey.length === 0) return null;
  return { field, evaluatorKey };
}
