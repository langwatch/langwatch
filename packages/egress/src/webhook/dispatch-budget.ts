import { DispatchError } from "@langwatch/eventing";
import type { WebhookDispatchRateLimiterPort } from "../ports/webhook-dispatch-rate-limiter.port";

/**
 * Per-scope hourly cap on real webhook dispatches — a backstop against an
 * immediate-cadence automation firing per match and turning the worker fleet
 * into an outbound flood. A safety limit, not a billing knob.
 *
 * FROZEN TWIN of `platform/app/src/server/webhooks/dispatchBudget.ts`. The
 * number, the window, and the key it counts under are all pinned as literals,
 * because both graphs count into ONE Redis keyspace while the pipelines are
 * twinned: a second process counting under a different key spends a budget the
 * first one was protecting, and a different ceiling lets the higher one through.
 */
export const WEBHOOK_DISPATCH_HOURLY_CAP = 1000;

/** The window the cap is counted over, in seconds. */
export const WEBHOOK_DISPATCH_WINDOW_SECONDS = 3600;

/** The counter key one scope's dispatches are counted under. */
export function webhookDispatchBudgetKey(scopeId: string): string {
  return `webhook-dispatch:${scopeId}`;
}

/**
 * The cap every dispatch boundary shares.
 *
 * It lives outside the HTTP sender because the platform has two boundaries: an
 * endpoint delivering to a queue would otherwise be uncapped, since it never
 * touches the HTTP sender the cap used to sit in. Each boundary calls this
 * exactly once per attempt, so an attempt is counted once no matter which one it
 * took.
 *
 * The scope is whatever owns the budget: a project for the automations channel,
 * an organization for the webhook endpoints platform.
 *
 * Over the cap this throws RETRYABLE with a Retry-After to the window reset: a
 * legitimate burst backs off and drains, a sustained flood dead-letters after the
 * outbox's max attempts.
 */
export async function assertDispatchBudget({
  rateLimiter,
  scopeId,
  label,
}: {
  rateLimiter: WebhookDispatchRateLimiterPort;
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
    retryAfterMs: Math.max(0, limit.resetAt - Date.now()),
  });
}
