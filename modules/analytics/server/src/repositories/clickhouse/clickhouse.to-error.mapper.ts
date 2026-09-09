/**
 * Anything thrown, as an `Error`.
 *
 * A `catch` binding is `unknown`, and every place that carries a cause forward
 * — `HandledError`'s `reasons`, a log line's `error` field — wants an `Error`.
 * One conversion, so a thrown string does not reach a log as `undefined`.
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
