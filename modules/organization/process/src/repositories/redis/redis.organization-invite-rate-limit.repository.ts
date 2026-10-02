import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";

import type { OrganizationInviteRateLimit } from "../../app/organization.members.ts";

/** The process's ONE fixed-window counter, over process Redis, as the invitation throttle
 * spends it: same shape as the model-provider connection limiter's own Redis adapter. */
export class RedisOrganizationInviteRateLimitRepository implements OrganizationInviteRateLimit {
  static create(redis: RedisConnection): RedisOrganizationInviteRateLimitRepository {
    return new RedisOrganizationInviteRateLimitRepository(redis);
  }

  private constructor(private readonly redis: RedisConnection) {}

  async limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number; count?: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>> {
    const counter = `organization:invite:rate-limit:${input.key}`;
    const now = nowInstant().epochMilliseconds;
    const count = input.count ?? 1;
    const used =
      count === 1 ? await this.redis.incr(counter) : await this.redis.incrby(counter, count);
    if (used === count) await this.redis.expire(counter, input.windowSeconds);
    if (used <= input.max) {
      return { allowed: true, resetAt: now + input.windowSeconds * 1000 };
    }

    const remaining = await this.redis.ttl(counter);
    return { allowed: false, resetAt: now + Math.max(remaining, 0) * 1000 };
  }
}
