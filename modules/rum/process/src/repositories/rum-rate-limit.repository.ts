export type RumRateLimitWindow = Readonly<{ key: string; windowSeconds: number; max: number }>;

export type RumRateLimitResult = Readonly<{ allowed: boolean; remaining: number; resetAt: number }>;

/** Fixed-window counters for the ingest door's buckets. */
export interface RumRateLimitRepository {
  limit(window: RumRateLimitWindow): Promise<RumRateLimitResult>;
}
