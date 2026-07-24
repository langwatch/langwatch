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
