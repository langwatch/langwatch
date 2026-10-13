/** What one rate-limit decision says; a refusal carries when to retry. */
export type LangyRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/** Fixed-window counters for the turn window, the panel's sends and its worker warms. */
export abstract class LangyRateLimitRepository {
  /** Counts one request against `key` in the caller's own window. */
  abstract check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<LangyRateLimitDecision>;
}
