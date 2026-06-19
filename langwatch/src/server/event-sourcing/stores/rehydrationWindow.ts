import type { AggregateType } from "../domain/aggregateType";

/**
 * Aggregate types whose events all fall within the aggregate's own lifetime
 * (a single trace, evaluation, or run). For these, a rehydration scan of
 * `event_log` can be safely lower-bounded to a window around the aggregate's
 * time without ever excluding one of its events — which lets ClickHouse prune
 * the weekly partitions older than the window instead of cold-scanning every
 * partition on S3.
 *
 * Long-lived aggregates that accumulate events across all history are
 * intentionally NOT listed and are always scanned unbounded:
 *  - `global` and `billing_report` aggregate over arbitrary time ranges;
 *  - `simulation_set` accumulates `simulation_run`s over its lifetime;
 *  - `test_aggregate` is test-only.
 *
 * This list is the correctness contract for the optimisation: only add a type
 * here if every event of such an aggregate is guaranteed to occur within
 * REHYDRATION_WINDOW_MS of any other event of the same aggregate.
 */
export const TIME_LOCAL_AGGREGATE_TYPES: ReadonlySet<AggregateType> =
  new Set<AggregateType>([
    "trace",
    "evaluation",
    "experiment_run",
    "simulation_run",
    "suite_run",
  ]);

/**
 * Lower-bound window subtracted from the anchor (the triggering event's
 * occurredAt) when bounding a time-local aggregate's rehydration scan.
 *
 * Must be:
 *  - LARGER than any time-local aggregate's lifetime, so no event is ever
 *    excluded (a trace/eval/run spans seconds to hours, far under this); and
 *  - SMALLER than `event_log` retention, so it actually prunes partitions.
 *
 * 45 days is a deliberately conservative default. Tune with care: the cost of
 * making it too small is silently dropping events from a re-fold (corrupted
 * projection), so it errs large.
 */
export const REHYDRATION_WINDOW_DAYS = 45;
export const REHYDRATION_WINDOW_MS =
  REHYDRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

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
