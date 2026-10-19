import { DispatchError } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { WebhookDispatchCapRepository } from "../repositories/webhook-dispatch-cap.repository.ts";

/**
 * Per-scope hourly cap on real webhook dispatches: a safety backstop, not
 * a billing knob. The number and window stay pinned as literals, since
 * every dispatching process must count into the same one Redis keyspace.
 */
const HOURLY_CAP = 1000;
const WINDOW_SECONDS = 3600;

/**
 * The cap every dispatch boundary shares, so a queue-delivering endpoint is
 * capped too (not just the HTTP sender). Over the cap it throws RETRYABLE
 * with a Retry-After: a burst backs off, a sustained flood dead-letters.
 */
export class WebhookDispatchCapService {
  private constructor(private readonly caps: WebhookDispatchCapRepository) {}

  static create(input: { caps: WebhookDispatchCapRepository }): WebhookDispatchCapService {
    return new WebhookDispatchCapService(input.caps);
  }

  async assertWithinCap({ scopeId, label }: { scopeId: string; label: string }): Promise<void> {
    const count = await this.caps.countAttempt({
      scopeId,
      windowSeconds: WINDOW_SECONDS,
      max: HOURLY_CAP,
    });
    if (count.allowed) return;
    throw new DispatchError({
      message: `${label}: webhook dispatch cap (${HOURLY_CAP}/hour) reached — backing off.`,
      retryable: true,
      retryAfterMs: Math.max(0, count.resetAt - nowInstant().epochMilliseconds),
    });
  }
}
