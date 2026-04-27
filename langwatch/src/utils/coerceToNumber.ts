/**
 * Coerces a value to a finite number or returns null.
 * Handles ClickHouse Map(String, String) where all values are strings.
 */
export function coerceToNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
