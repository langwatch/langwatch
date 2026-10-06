/** What one rate-limit decision says. */
export type AuthRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/** Fixed-window counters for the sign-in door and the token check, each key in its own window. */
export interface AuthRateLimitRepository {
  /** Counts one request against `key`. */
  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<AuthRateLimitDecision>;
}
