/** What one rate-limit decision says; a refusal carries when to retry. */
export type ScenarioRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/** Fixed-window counters for the author-assist's generation window. */
export abstract class ScenarioRateLimitRepository {
  /** Counts one request against `key` in the caller's own window. */
  abstract check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<ScenarioRateLimitDecision>;
}
