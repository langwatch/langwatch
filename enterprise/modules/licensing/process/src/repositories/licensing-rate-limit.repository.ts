/** What one rate-limit decision says; a refusal carries when to retry. */
export type LicensingRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/** Fixed-window counters for activation-code guesses and license syncs. */
export abstract class LicensingRateLimitRepository {
  /** Counts one request against `key` in the caller's own window. */
  abstract check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<LicensingRateLimitDecision>;
}
