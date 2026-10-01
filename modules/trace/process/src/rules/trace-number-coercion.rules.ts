/**
 * Coerces a value to a finite number or returns null.
 * Handles ClickHouse Map(String, String) where all values are strings.
 */
export function coerceToNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);

    return Number.isFinite(number) ? number : null;
  }

  return null;
}
