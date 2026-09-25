import type { WebhookDispatchRateLimitResult } from "@langwatch/egress";
import { nowInstant } from "@langwatch/time";

import { AutomationWebhookRateLimitRepository } from "../automation-webhook-rate-limit.repository.ts";

/** The webhook dispatch budget, counted by this process. */
export class MemoryAutomationWebhookRateLimitRepository extends AutomationWebhookRateLimitRepository {
  static create(): MemoryAutomationWebhookRateLimitRepository {
    return new MemoryAutomationWebhookRateLimitRepository();
  }

  private readonly windows = new Map<string, { count: number; expiresAt: number }>();

  private constructor() {
    super();
  }

  limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<WebhookDispatchRateLimitResult> {
    const now = nowInstant().epochMilliseconds;
    const open = this.windows.get(input.key);
    const window =
      open !== undefined && open.expiresAt > now
        ? open
        : { count: 0, expiresAt: now + input.windowSeconds * 1000 };
    window.count += 1;
    this.windows.set(input.key, window);
    return Promise.resolve({
      allowed: window.count <= input.max,
      remaining: Math.max(0, input.max - window.count),
      resetAt: window.expiresAt,
    });
  }
}
