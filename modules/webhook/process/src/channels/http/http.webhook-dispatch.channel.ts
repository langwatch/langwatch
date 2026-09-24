import {
  WebhookDispatchRateLimiter,
  WebhookEgressService,
  type WebhookDispatchRateLimitResult,
  type WebhookSendInput,
  type WebhookSendResult,
} from "@langwatch/egress";
import { nowInstant } from "@langwatch/time";

import type { WebhookDispatchChannel } from "../webhook-dispatch.channel.ts";

/** The three counter calls the dispatch cap makes on the process Redis member. */
export interface WebhookDispatchCounter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

/** HTTPS through the SSRF-fenced egress, under main's hourly dispatch cap. */
export class HttpWebhookDispatchChannel implements WebhookDispatchChannel {
  static create(input: {
    redis: WebhookDispatchCounter;
    rejectUnauthorized: boolean;
  }): HttpWebhookDispatchChannel {
    return new HttpWebhookDispatchChannel(
      WebhookEgressService.create({
        rateLimiter: new RedisWebhookDispatchRateLimiter(input.redis),
        tls: { rejectUnauthorized: input.rejectUnauthorized },
      }),
    );
  }

  private constructor(private readonly egress: WebhookEgressService) {}

  send(input: WebhookSendInput): Promise<WebhookSendResult> {
    return this.egress.send(input);
  }
}

/** The hourly dispatch cap under main's key prefix, shared with automation's alert webhooks. */
class RedisWebhookDispatchRateLimiter extends WebhookDispatchRateLimiter {
  constructor(private readonly connection: WebhookDispatchCounter) {
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
