import { nowInstant } from "@langwatch/time";

import type {
  WebhookRateLimitDecision,
  WebhookRateLimitRepository,
} from "../webhook-rate-limit.repository.ts";

/** The Redis limiter's memory twin: one fixed window per key, held in this process. */
export class MemoryWebhookRateLimitRepository implements WebhookRateLimitRepository {
  static create(): MemoryWebhookRateLimitRepository {
    return new MemoryWebhookRateLimitRepository();
  }

  readonly #windows = new Map<string, { used: number; resetAt: number }>();

  private constructor() {}

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<WebhookRateLimitDecision> {
    const now = nowInstant().epochMilliseconds;
    const open = this.#windows.get(key);
    const window =
      open && open.resetAt > now ? open : { used: 0, resetAt: now + limit.seconds * 1000 };
    window.used += 1;
    this.#windows.set(key, window);
    if (window.used <= limit.requests) return Promise.resolve({ allowed: true });
    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    return Promise.resolve({ allowed: false, retryAfterSeconds });
  }
}
