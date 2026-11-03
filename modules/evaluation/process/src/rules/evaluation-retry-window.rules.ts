/**
 * Whether a retryable evaluator failure (the evaluator service still starting, restarting or
 * down) of an evaluation issued at `occurredAt` goes back to the queue rather than being recorded
 * as an error. `windowMs` is the deployment's setting (evaluatorRetryWindowMinutes).
 */
export function isWithinEvaluationRetryWindow({
  occurredAt,
  now,
  windowMs,
}: {
  occurredAt: number;
  now: number;
  windowMs: number;
}): boolean {
  return now - occurredAt < windowMs;
}

/** The shortest wait before another attempt, and the floor for the first. */
export const EVALUATION_RETRY_BASE_DELAY_MS = 5_000;
/** The longest wait between two attempts. */
export const EVALUATION_RETRY_MAX_DELAY_MS = 10 * 60_000;

/**
 * How long to wait after failed `attempt` (from 1) before the next: doubling from five seconds,
 * never shorter than what the evaluator service asked for (`retryAfterMs`), at most ten minutes.
 */
export function evaluationRetryDelayMs({
  attempt,
  retryAfterMs,
}: {
  attempt: number;
  retryAfterMs: number | undefined;
}): number {
  const backoff = EVALUATION_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  const asked = retryAfterMs ?? EVALUATION_RETRY_BASE_DELAY_MS;
  return Math.min(EVALUATION_RETRY_MAX_DELAY_MS, Math.max(asked, backoff));
}
