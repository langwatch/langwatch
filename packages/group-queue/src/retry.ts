export const JOB_RETRY_CONFIG = {
  maxAttempts: 25,
  backoffBaseMs: 500,
  maxBackoffMs: 600_000,
} as const;

export function getBackoffMs(attempt: number): number {
  return Math.min(
    JOB_RETRY_CONFIG.backoffBaseMs * Math.pow(2, attempt - 1),
    JOB_RETRY_CONFIG.maxBackoffMs,
  );
}
