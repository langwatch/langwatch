import { nowInstant } from "@langwatch/time";

import type {
  WebhookDispatchCapCount,
  WebhookDispatchCapRepository,
} from "../webhook-dispatch-cap.repository.ts";

/** The three counter calls the dispatch cap makes on the process Redis member. */
export interface WebhookDispatchCounter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

/**
 * The hourly dispatch cap, counted under main's key prefix: a different key
 * would spend a budget the platform's own limiter protects.
 */
export class RedisWebhookDispatchCapRepository implements WebhookDispatchCapRepository {
  static create(input: { connection: WebhookDispatchCounter }): RedisWebhookDispatchCapRepository {
    return new RedisWebhookDispatchCapRepository(input.connection);
  }

  private constructor(private readonly connection: WebhookDispatchCounter) {}

  async countAttempt(input: {
    scopeId: string;
    windowSeconds: number;
    max: number;
  }): Promise<WebhookDispatchCapCount> {
    const key = `langwatch:ratelimit:webhook-dispatch:${input.scopeId}`;
    const count = await this.connection.incr(key);
    if (count === 1) {
      await this.connection.expire(key, input.windowSeconds);
    }
    const ttl = await this.connection.ttl(key);
    return {
      allowed: count <= input.max,
      remaining: Math.max(0, input.max - count),
      resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
    };
  }
}
