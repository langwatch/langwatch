import type { LangyFrameDedupRepository } from "../langy-live-turn.repository.ts";

/** Redis-backed cross-instance frame nonce deduplication for Langy relay frames. */
export interface LangyFrameDedupRedis {
  sadd(key: string, member: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export class LangyFrameDedupRedisRepository implements LangyFrameDedupRepository {
  private constructor(
    private readonly redis: LangyFrameDedupRedis,
    private readonly ttlSeconds: number,
  ) {}

  static create(options: {
    redis: LangyFrameDedupRedis;
    ttlSeconds?: number;
  }): LangyFrameDedupRedisRepository {
    return new LangyFrameDedupRedisRepository(options.redis, options.ttlSeconds ?? 3600);
  }

  async reserveFrameNonce(input: {
    conversationId: string;
    turnId: string;
    frameNonce: string;
  }): Promise<boolean> {
    const key = `langy:seen:${input.conversationId}:${input.turnId}`;
    const fresh = (await this.redis.sadd(key, input.frameNonce)) === 1;
    if (fresh) await this.redis.expire(key, this.ttlSeconds);
    return fresh;
  }
}
