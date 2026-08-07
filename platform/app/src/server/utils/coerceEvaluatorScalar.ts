// Per-`typeof` coercion, keyed the same way the ordered checks used to be.
// Types not listed here (object, function, symbol) fall through to the
// JSON-serialize path in coerceEvaluatorScalar.
const SCALAR_COERCERS: Partial<Record<string, (value: any) => unknown>> = {
  string: (value: string) => value,
  boolean: (value: boolean) => (value ? "true" : "false"),
  number: (value: number) => (Number.isFinite(value) ? String(value) : null),
  bigint: (value: bigint) => value.toString(),
};

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

  const coerce = SCALAR_COERCERS[typeof value];
  if (coerce) return coerce(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
