import { nowInstant } from "@langwatch/time";

import type {
  WebhookDispatchCapCount,
  WebhookDispatchCapRepository,
} from "../webhook-dispatch-cap.repository.ts";

/** The hourly dispatch cap, counted by this process alone. */
export class MemoryWebhookDispatchCapRepository implements WebhookDispatchCapRepository {
  static create(): MemoryWebhookDispatchCapRepository {
    return new MemoryWebhookDispatchCapRepository();
  }

  private readonly windows = new Map<string, { count: number; expiresAt: number }>();

  private constructor() {}

  countAttempt(input: {
    scopeId: string;
    windowSeconds: number;
    max: number;
  }): Promise<WebhookDispatchCapCount> {
    const now = nowInstant().epochMilliseconds;
    const open = this.windows.get(input.scopeId);
    const window =
      open !== undefined && open.expiresAt > now
        ? open
        : { count: 0, expiresAt: now + input.windowSeconds * 1000 };
    window.count += 1;
    this.windows.set(input.scopeId, window);
    return Promise.resolve({
      allowed: window.count <= input.max,
      remaining: Math.max(0, input.max - window.count),
      resetAt: window.expiresAt,
    });
  }
}
