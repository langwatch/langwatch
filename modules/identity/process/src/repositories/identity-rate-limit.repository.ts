/** What one rate-limit decision says; a refusal carries when to retry. */
export type IdentityRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/**
 * Fixed-window counters for identity's throttles: join requests, confirmation mails and the
 * operator lookup's attempt budget. No `limit` takes the deployment's own default window.
 */
export abstract class IdentityRateLimitRepository {
  /** Counts one request against `key` in the caller's window, or the deployment's. */
  abstract check(
    key: string,
    limit?: Readonly<{ requests: number; seconds: number }>,
  ): Promise<IdentityRateLimitDecision>;
}
