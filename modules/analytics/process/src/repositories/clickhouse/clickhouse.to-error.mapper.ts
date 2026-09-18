/**
 * Anything thrown, as an `Error`. A `catch` binding is `unknown`, but every
 * place that carries a cause forward wants an `Error` — one conversion, so
 * a thrown string doesn't reach a log as `undefined`.
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
