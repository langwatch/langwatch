/** How a tenant's broadcast allowance refills: main's `TenantRateLimiter` defaults. */
export type BroadcastRateTier = "structural" | "delta";

export type BroadcastTokenBucket = Readonly<{ tokens: number; lastAccessMs: number }>;

export const BROADCAST_RATE_TIERS: Readonly<
  Record<BroadcastRateTier, Readonly<{ capacity: number; refillPerSecond: number }>>
> = {
  structural: { capacity: 200, refillPerSecond: 200 },
  delta: { capacity: 500, refillPerSecond: 200 },
};

/** A bucket untouched this long is forgotten, and starts full when next asked. */
export const BROADCAST_BUCKET_STALE_MS = 60_000;

/** One event's worth of allowance: whether it may be sent, and the bucket that remains. */
export function consumeBroadcastToken({
  bucket,
  tier,
  nowMs,
}: {
  bucket: BroadcastTokenBucket | undefined;
  tier: BroadcastRateTier;
  nowMs: number;
}): { allowed: boolean; bucket: BroadcastTokenBucket } {
  const { capacity, refillPerSecond } = BROADCAST_RATE_TIERS[tier];
  const current = bucket ?? { tokens: capacity, lastAccessMs: nowMs };
  const elapsedSeconds = (nowMs - current.lastAccessMs) / 1000;
  const tokens = Math.min(capacity, current.tokens + elapsedSeconds * refillPerSecond);

  if (tokens >= 1) {
    return { allowed: true, bucket: { tokens: tokens - 1, lastAccessMs: nowMs } };
  }
  return { allowed: false, bucket: { tokens, lastAccessMs: nowMs } };
}
