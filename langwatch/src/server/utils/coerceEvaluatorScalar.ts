/**
 * Coerce a mapped evaluator input value to its string form before the request
 * is validated against the langevals schema.
 *
 * Parity with langwatch_nlp/studio/field_parser.py `autoparse_field_value` for
 * `FieldType.str`: strings pass through, null/undefined are preserved, every
 * other shape is JSON-serialized. The batch and online paths already apply the
 * same semantics via tracesMapping.ts `tryAndConvertTo`; this helper exists so
 * the workbench REST live-execute path produces an identical string before the
 * Zod schema rejects it.
 */
export const coerceEvaluatorScalar = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "bigint") return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
