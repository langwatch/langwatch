import { DispatchError } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { WebhookDispatchRateLimiter } from "../services/webhook-dispatch-rate-limiter.service.ts";

/**
 * Per-scope hourly cap on real webhook dispatches — a safety backstop, not
 * a billing knob. The number, window and key stay pinned as literals, since
 * every dispatching process must count into the same one Redis keyspace.
 */
export const WEBHOOK_DISPATCH_HOURLY_CAP = 1000;

/** The window the cap is counted over, in seconds. */
export const WEBHOOK_DISPATCH_WINDOW_SECONDS = 3600;

/** The counter key one scope's dispatches are counted under. */
export function webhookDispatchBudgetKey(scopeId: string): string {
  return `webhook-dispatch:${scopeId}`;
}

/**
 * The cap every dispatch boundary shares, so a queue-delivering endpoint is
 * capped too (not just the HTTP sender). Over the cap it throws RETRYABLE
 * with a Retry-After: a burst backs off, a sustained flood dead-letters.
 */
export async function assertDispatchBudget({
  rateLimiter,
  scopeId,
  label,
}: {
  rateLimiter: WebhookDispatchRateLimiter;
  scopeId: string;
  label: string;
}): Promise<void> {
  const limit = await rateLimiter.limit({
    key: webhookDispatchBudgetKey(scopeId),
    windowSeconds: WEBHOOK_DISPATCH_WINDOW_SECONDS,
    max: WEBHOOK_DISPATCH_HOURLY_CAP,
  });
  if (limit.allowed) return;
  throw new DispatchError({
    message: `${label}: webhook dispatch cap (${WEBHOOK_DISPATCH_HOURLY_CAP}/hour) reached — backing off.`,
    retryable: true,
    retryAfterMs: Math.max(0, limit.resetAt - nowInstant().epochMilliseconds),
  });
}
