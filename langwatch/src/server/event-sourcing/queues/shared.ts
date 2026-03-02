/**
 * Shared retry configuration for group queue jobs.
 */
export const JOB_RETRY_CONFIG = {
  maxAttempts: 15,
  backoffDelayMs: 2000,
} as const;
