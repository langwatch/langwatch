/**
 * The "intentional retry" signal for the Langy dispatch reactors.
 *
 * Thrown when a turn could not be handed to the agent — the manager did not
 * accept the dispatch, or a live turn's worker went silent (heartbeat lapsed).
 * It is a plain (non-CRITICAL) Error, so `isRetryableJobError` classifies it as
 * RETRYABLE and the GroupQueue re-fires the reactor with exponential backoff, up
 * to `JOB_RETRY_CONFIG.maxAttempts`.
 *
 * This is the whole self-retry mechanism: the reactor just FAILS and the queue
 * retries it. No reactor emits an event to re-drive (that would double-fire on
 * replay); the retry is simply the queue re-running the same reactor. The
 * dispatch is idempotent on turnId (Go `ClaimTurn`), so a re-fire that races a
 * now-live worker is a benign no-op.
 */
export class LangyTurnDispatchRetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangyTurnDispatchRetry";
  }
}
