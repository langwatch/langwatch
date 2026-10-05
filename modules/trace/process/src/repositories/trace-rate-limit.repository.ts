/** What one rate-limit decision says; a refusal carries when to retry. */
export type TraceRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/** Fixed-window counters for the export door and the anonymous share read. */
export abstract class TraceRateLimitRepository {
  /** Counts one request against `key` in the caller's own window. */
  abstract check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<TraceRateLimitDecision>;
}
