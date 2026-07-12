/**
 * Shared, cross-instance frameNonce dedup for the Langy relay
 * (LANGY_WORKER_REDESIGN_PLAN §0a/§0b): the intra-turn replay guard.
 *
 * A Redis SET per (conversation, turn) records the frameNonces already seen.
 * Because it lives in Redis, any of the load-balanced web instances agrees —
 * a frame redelivered to a different instance after a reconnect is still caught.
 * `SADD` is atomic and returns 1 only for a genuinely new member, so "reserve"
 * and "was-it-new" are one round-trip with no race.
 *
 * The set is soft state: it is TTL'd to a turn's lifetime and rebuilt empty
 * after a Redis flush / restart. That leaves at most a narrow replay window right
 * after a restart, which content frames tolerate (they are idempotent at the app
 * layer on token offset / tool-call id / turnId) — only a replayed heartbeat
 * could briefly matter, and it can only extend liveness by one window.
 */

/** The minimal Redis surface the dedup uses. Injected so tests drive a fake. */
export interface LangyFrameDedupRedis {
  sadd(key: string, member: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

/** Default: a turn's frames all land well inside an hour. */
const SEEN_TTL_SECONDS = 3600;

export interface LangyFrameDedup {
  /**
   * Reserve a frameNonce for a turn. Returns true if it was UNSEEN (fresh — apply
   * the frame), false if already present (a replay/redelivery — drop it).
   */
  reserveFrameNonce(a: {
    conversationId: string;
    turnId: string;
    frameNonce: string;
  }): Promise<boolean>;
}

export function createLangyFrameDedup(deps: {
  redis: LangyFrameDedupRedis;
  ttlSeconds?: number;
}): LangyFrameDedup {
  const ttl = deps.ttlSeconds ?? SEEN_TTL_SECONDS;
  return {
    async reserveFrameNonce({ conversationId, turnId, frameNonce }) {
      const key = `langy:seen:${conversationId}:${turnId}`;
      const added = await deps.redis.sadd(key, frameNonce);
      const fresh = added === 1;
      // Only (re)arm the TTL when we actually added — a duplicate must never
      // extend the window and let a truly-old nonce fall out and be replayed.
      if (fresh) {
        await deps.redis.expire(key, ttl);
      }
      return fresh;
    },
  };
}
