/**
 * Query-construction helpers for `ClickHouseExperimentRunService`.
 *
 * Kept separate from the service so the service file can stay focused on
 * orchestration (call query, map result, return) rather than mixing in
 * partition-bound math and SQL parameter derivation.
 */

import {
  formatClickHouseDateTime,
  parseClickHouseDateTime,
} from "~/server/clickhouse/dateTime";
import type { ClickHouseExperimentRunRow } from "./mappers";

/**
 * Buffer applied to OccurredAt range filters, in milliseconds.
 *
 * `experiment_runs.UpdatedAt` is server wall-clock (`Date.now()` on the API
 * node), but `experiment_run_items.OccurredAt` is sourced from the SDK's
 * `event.occurredAt` — i.e. the wall-clock of whatever machine ran the
 * BatchEvaluation, which in practice is often a developer laptop. Client
 * clock drift (not inter-node ClickHouse skew) is the dominant source of
 * skew here and can realistically reach several hours.
 *
 * 24h is wide enough to absorb everyday client drift while still pruning
 * the vast majority of weekly partitions. If specific users start seeing
 * phantom-missing items in the breakdown / cost summary, widen further or
 * watch for `WARN_OLD_RUN_AGE_MS` log entries paired with user reports.
 *
 * Tunable: lift to a config module / env var if we ever need to vary it
 * per environment.
 */
export const OCCURRED_AT_BUFFER_MS = 24 * 60 * 60 * 1000;

/**
 * If any run being queried has a `CreatedAt` older than this, the service
 * emits a warning. Lets us re-tune `OCCURRED_AT_BUFFER_MS` empirically: if
 * old-run warnings coincide with user reports of missing breakdown rows,
 * the buffer is too tight for the client-clock drift in that environment.
 */
export const WARN_OLD_RUN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Derive a tight OccurredAt range for `experiment_run_items` queries from
 * the runs being queried. Items can't be older than the earliest run's
 * CreatedAt or newer than the latest run's UpdatedAt (modulo clock skew /
 * late writes, absorbed by `OCCURRED_AT_BUFFER_MS`). This bound lets
 * ClickHouse prune the weekly partitions that don't overlap the run window.
 *
 * Returns ClickHouse-formatted DateTime64(3) strings ready to pass as query
 * parameters, plus the raw `minMs` so the caller can decide whether to emit
 * an old-runs warning without reparsing the timestamps.
 *
 * Throws if `runs` is empty — callers must guard. Without this check the
 * function would silently return `Invalid Date` strings (from
 * `Math.min(...[])` → `Infinity`) which ClickHouse would reject with an
 * opaque parse error.
 */
export function computeOccurredAtRangeForRuns(
  runs: Pick<ClickHouseExperimentRunRow, "CreatedAt" | "UpdatedAt">[],
): { minOccurredAt: string; maxOccurredAt: string; minMs: number } {
  if (runs.length === 0) {
    throw new Error(
      "computeOccurredAtRangeForRuns called with no runs; caller must guard",
    );
  }
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const r of runs) {
    minMs = Math.min(minMs, parseClickHouseDateTime(r.CreatedAt).getTime());
    maxMs = Math.max(maxMs, parseClickHouseDateTime(r.UpdatedAt).getTime());
  }
  return {
    minOccurredAt: formatClickHouseDateTime(
      new Date(minMs - OCCURRED_AT_BUFFER_MS),
    ),
    maxOccurredAt: formatClickHouseDateTime(
      new Date(maxMs + OCCURRED_AT_BUFFER_MS),
    ),
    minMs,
  };
}
