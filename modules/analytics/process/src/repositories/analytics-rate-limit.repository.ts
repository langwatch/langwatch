/** What one rate-limit decision says; a refusal carries when to retry. */
export type AnalyticsRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/** Fixed-window counters for the LangWatchQL execution window. */
export abstract class AnalyticsRateLimitRepository {
  /** Counts one request against `key` in the caller's own window. */
  abstract check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<AnalyticsRateLimitDecision>;
}
