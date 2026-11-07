/** A plain decimal, optionally signed and with an exponent; no hex, no trailing text. */
const DECIMAL_BOUND = /^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/;

/** One `evaluations.score` bound, or null when it is not a plain decimal. */
export function parseScoreBound(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw);
  if (!DECIMAL_BOUND.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** The `evaluations.score` range [min, max], or null when short, non-decimal or inverted. */
export function parseScoreRange(values: readonly unknown[]): { min: number; max: number } | null {
  if (values.length < 2) return null;
  const min = parseScoreBound(values[0]);
  const max = parseScoreBound(values[1]);
  if (min === null || max === null || min > max) return null;
  return { min, max };
}
