/** What one rate-limit decision says; a refusal carries when to retry. */
export type StoredObjectRateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds?: number;
}>;

/** Fixed-window counters for the file door's reads. */
export abstract class StoredObjectRateLimitRepository {
  /** Counts one request against `key` in the caller's own window. */
  abstract check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<StoredObjectRateLimitDecision>;
}
