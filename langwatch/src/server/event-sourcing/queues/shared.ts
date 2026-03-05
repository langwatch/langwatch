/**
 * Shared retry configuration for group queue jobs.
 *
 * Jobs are re-staged with a future dispatch score instead of sleeping inside
 * a fastq worker slot, freeing concurrency immediately after failure.
 *
 * Backoff schedule (capped at maxBackoffMs):
 *   attempt 1 → 500ms, 2 → 1s, 3 → 2s, 4 → 4s, 5 → 8s, 6+ → 15s
 */
export const JOB_RETRY_CONFIG = {
  maxAttempts: 15,
  backoffBaseMs: 500,
  maxBackoffMs: 15_000,
} as const;

/**
 * Compute the backoff delay for a given attempt number (1-based).
 */
export function getBackoffMs(attempt: number): number {
  const delay = JOB_RETRY_CONFIG.backoffBaseMs * Math.pow(2, attempt - 1);
  return Math.min(delay, JOB_RETRY_CONFIG.maxBackoffMs);
}
