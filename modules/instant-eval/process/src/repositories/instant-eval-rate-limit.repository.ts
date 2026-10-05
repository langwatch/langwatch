/**
 * The deployment's two token buckets for the judge: the global one and one
 * tenant's share, refilled and taken from together or not at all.
 * @see specs/instant-evals/classifier.feature
 */

/** The rates and burst sizes both buckets refill at. */
export interface InstantEvalRateLimitBuckets {
  readonly tokensPerSecond: number;
  readonly capacity: number;
  readonly tenantTokensPerSecond: number;
  readonly tenantCapacity: number;
}

export interface InstantEvalRateLimitRepository {
  /**
   * Takes `wanted` from both buckets, or from neither, and answers how many
   * milliseconds to wait before asking again (0 when taken). Throws when the
   * buckets cannot be reached; the caller decides what that means.
   */
  take(input: {
    wanted: number;
    tenantId: string;
    nowMs: number;
    buckets: InstantEvalRateLimitBuckets;
  }): Promise<number>;
}
