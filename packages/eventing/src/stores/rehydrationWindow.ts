import type { AggregateType } from "../domain/aggregateType.ts";

/**
 * Time-local aggregate types (trace, evaluation, run) whose events fit within their own
 * lifetime; enables window-based partition pruning. Long-lived types are omitted.
 */
export const TIME_LOCAL_AGGREGATE_TYPES: ReadonlySet<AggregateType> = new Set<AggregateType>([
  "trace",
  "evaluation",
  "experiment_run",
  "simulation_run",
  "suite_run",
]);

/**
 * Lower-bound window for time-local rehydration scans; must be larger than
 * aggregate lifetime but smaller than retention to prune partitions safely.
 */
export const REHYDRATION_WINDOW_DAYS = 45;
export const REHYDRATION_WINDOW_MS = REHYDRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Returns the `EventOccurredAt` lower bound (ms) to apply to an aggregate's
 * rehydration scan, or `undefined` when the scan must stay unbounded.
 *
 * Unbounded (returns undefined) when the aggregate type is not time-local, or
 * when no usable anchor time is available — in both cases the caller falls back
 * to the full, partition-spanning scan.
 */
export function rehydrationLowerBoundMs(
  aggregateType: AggregateType,
  anchorOccurredAtMs: number | undefined,
): number | undefined {
  if (!TIME_LOCAL_AGGREGATE_TYPES.has(aggregateType)) return undefined;
  if (typeof anchorOccurredAtMs !== "number" || anchorOccurredAtMs <= 0) {
    return undefined;
  }
  return Math.max(0, anchorOccurredAtMs - REHYDRATION_WINDOW_MS);
}
