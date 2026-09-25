import type { WebhookDispatchRateLimitResult } from "@langwatch/egress";
import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";

import { AutomationWebhookRateLimitRepository } from "../automation-webhook-rate-limit.repository.ts";

/**
 * The webhook dispatch cap, counted in Redis under main's key prefix: a different
 * key would spend a budget the platform's own limiter protects.
 */
export class RedisAutomationWebhookRateLimitRepository extends AutomationWebhookRateLimitRepository {
  static create(input: {
    connection: Pick<RedisConnection, "incr" | "expire" | "ttl">;
  }): RedisAutomationWebhookRateLimitRepository {
    return new RedisAutomationWebhookRateLimitRepository(input.connection);
  }

  private constructor(
    private readonly connection: Pick<RedisConnection, "incr" | "expire" | "ttl">,
  ) {
    super();
  }

  async limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<WebhookDispatchRateLimitResult> {
    const redisKey = `langwatch:ratelimit:${input.key}`;
    const count = await this.connection.incr(redisKey);
    if (count === 1) {
      await this.connection.expire(redisKey, input.windowSeconds);
    }
    const ttl = await this.connection.ttl(redisKey);
    return {
      allowed: count <= input.max,
      remaining: Math.max(0, input.max - count),
      resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
    };
  }
}
