/**
 * Clamps a nullable duration to a non-negative value.
 * Clock skew can produce negative durations that overflow ClickHouse UInt64 columns.
 */
export function normalizeDurationMs(duration: number | null | undefined): number | null {
  return duration != null ? Math.max(0, duration) : null;
}
