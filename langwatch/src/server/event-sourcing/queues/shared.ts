/**
 * Shared retry configuration for group queue jobs.
 *
 * Jobs are re-staged with a future dispatch score instead of sleeping inside
 * a fastq worker slot, freeing concurrency immediately after failure.
 *
 * Backoff schedule (capped at maxBackoffMs):
 *   1 → 500ms, 2 → 1s, 3 → 2s, 4 → 4s, 5 → 8s, 6 → 16s, 7 → 32s,
 *   8 → 64s, 9 → 128s, 10 → 256s, 11 → 512s, 12 → 600s (cap), 13+ → 600s.
 *
 * Cumulative wait across 25 attempts (24 gaps) ≈ 2h 27m, which is enough
 * room to ride out a ClickHouse rolling restart / ZooKeeper session-recovery
 * cycle without parking the group in `:blocked`. Failed jobs sit in the
 * Redis zset until they succeed or are drained, so a long budget never
 * loses data — it just trades operator toil for auto-recovery.
 */
export const JOB_RETRY_CONFIG = {
  maxAttempts: 25,
  backoffBaseMs: 500,
  maxBackoffMs: 600_000,
} as const;

/**
 * Compute the backoff delay for a given attempt number (1-based).
 */
export function getBackoffMs(attempt: number): number {
  const delay = JOB_RETRY_CONFIG.backoffBaseMs * Math.pow(2, attempt - 1);
  return Math.min(delay, JOB_RETRY_CONFIG.maxBackoffMs);
}

/**
 * Job types whose spans CONTINUE the publishing trace instead of starting a new
 * root.
 *
 * Everything else gets `root: true`, because a single command can stage
 * hundreds of thousands of jobs — one OTLP ingest with 330k+ spans — all
 * carrying the same originating context. Inheriting it collapsed them into one
 * shared traceId whose remote root was never exported, producing the ~6-minute
 * empty-root mega-trace that OOM-crash-looped the observability Tempo on WAL
 * replay (#5894).
 *
 * That failure mode is specific to per-span fan-out. Subscribers and scheduled
 * jobs are low-volume and roughly one-per-event, so the mega-trace risk does
 * not apply and end-to-end continuity from publish to handler is worth more
 * than isolation — an automation that fires on a trace should be one trace.
 *
 * Ingest lanes (`handler` = map projections, `projection` = folds, `command`,
 * `reactor`) all multiply with span count, so they stay rooted and keep
 * causality via a span LINK instead.
 */
export const TRACE_CONTINUING_JOB_TYPES: ReadonlySet<string> = new Set([
  "subscriber",
  "job",
]);
