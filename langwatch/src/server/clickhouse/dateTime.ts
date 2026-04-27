/**
 * Canonical helpers for serializing and parsing ClickHouse DateTime64(3)
 * values across the codebase.
 *
 * ClickHouse returns DateTime64(3) as space-separated strings without a
 * timezone suffix (e.g. "2024-01-15 10:30:00.000"); they should be treated
 * as UTC. Two parse variants exist for caller convenience but share the same
 * underlying parsing logic — there is exactly one definition of "what does
 * ClickHouse mean by a DateTime64 string" in the codebase.
 *
 * Use `parseClickHouseDateTime` when you need a `Date` (e.g. arithmetic
 * before round-tripping back to ClickHouse). Use `parseClickHouseDateTimeMs`
 * when the canonical domain type is `number` (Unix epoch ms).
 */

/** Format a Date as a ClickHouse DateTime64(3) string (no timezone). */
export function formatClickHouseDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/** Parse a ClickHouse DateTime64(3) string into a JS Date (UTC). */
export function parseClickHouseDateTime(s: string): Date {
  return new Date(s.replace(" ", "T") + "Z");
}

/**
 * Parse a ClickHouse DateTime64(3) string into Unix epoch milliseconds.
 * Returns 0 on parse failure, matching the prior behavior of the inline
 * implementation in `evaluations-v3/services/mappers.ts`.
 */
export function parseClickHouseDateTimeMs(s: string): number {
  const ms = parseClickHouseDateTime(s).getTime();
  return isNaN(ms) ? 0 : ms;
}
