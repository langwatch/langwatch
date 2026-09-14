/** Shared retry configuration for group queue jobs with exponential backoff (max 25 attempts). */
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
