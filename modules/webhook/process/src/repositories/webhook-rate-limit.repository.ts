/** What one rate-limit decision says; a refusal carries when to retry. */
export type WebhookRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/** Fixed-window counters for the test-fire door's per-organization window. */
export interface WebhookRateLimitRepository {
  /** Counts one request against `key` in the caller's own window. */
  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<WebhookRateLimitDecision>;
}
