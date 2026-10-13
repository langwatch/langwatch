/** What one rate-limit decision says; a refusal carries when to retry. */
export type PromptRateLimitDecision = Readonly<{ allowed: boolean; retryAfterSeconds?: number }>;

/** Fixed-window counters for the playground's execution door. */
export abstract class PromptRateLimitRepository {
  /** Counts one request against `key` in the caller's own window. */
  abstract check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<PromptRateLimitDecision>;
}
