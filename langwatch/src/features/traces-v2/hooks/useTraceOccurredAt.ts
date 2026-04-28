/**
 * Parses the `t` URL drawer param into a millisecond timestamp.
 *
 * `t` is the trace's approximate occurredAt, written by the row click that
 * opened the drawer. Threading it into span queries gives ClickHouse a
 * partition-pruning hint on `stored_spans` (partitioned by week of
 * StartTime). Returns undefined for missing/invalid values so the server
 * falls back to the unconstrained scan path.
 */
export function parseOccurredAtMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
