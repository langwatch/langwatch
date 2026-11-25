/** Grading scenario runs; retries while trace data arrives, with a growing delay. */
export const SCENARIO_EVALUATIONS_JOB = {
  /** How many times grading runs before it records missing trace data as failed. */
  MAX_ATTEMPTS: 6,
  /** Delay before the second attempt; each later attempt waits twice as long. */
  BACKOFF_DELAY_MS: 3_000,
  /** How long one grading attempt holds its lease; outlives the slowest grading. */
  LEASE_MS: 5 * 60 * 1000,
} as const;

/** How many characters of one resolved input a result stores for the UI. */
export const MAX_STORED_INPUT_LENGTH = 2_000;

/** The delay before the attempt after the given one, doubling per attempt. */
export function backoffDelayMs(attempt: number): number {
  return SCENARIO_EVALUATIONS_JOB.BACKOFF_DELAY_MS * 2 ** Math.max(attempt - 1, 0);
}

/** Whether the attempt is the last one grading makes. */
export function isFinalAttempt(attempt: number): boolean {
  return attempt >= SCENARIO_EVALUATIONS_JOB.MAX_ATTEMPTS;
}
