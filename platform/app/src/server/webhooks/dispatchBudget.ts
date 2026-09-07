import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { rateLimit } from "~/server/rateLimit";

/**
 * Per-scope hourly cap on real webhook dispatches (ADR-040 §4) — a backstop
 * against an immediate-cadence trigger firing per-match turning our worker
 * fleet into an outbound flood. A safety limit, not a billing knob; promote to
 * an env var if a customer legitimately needs a higher ceiling.
 */
export const WEBHOOK_DISPATCH_HOURLY_CAP = 1000;

/**
 * The cap every dispatch boundary shares.
 *
 * It lives here rather than inside one transport because the platform now
 * has two: an endpoint delivering to a queue would otherwise be uncapped,
 * since it never touches the HTTP sender the cap used to sit in. Each
 * boundary calls this exactly once per attempt — the HTTP transport through
 * `sendWebhook`, the queue transport directly — so an attempt is counted
 * once no matter which one it took.
 *
 * The scope is whatever owns the budget: a project for the automations
 * channel, an organization for the webhook endpoints platform, which is what
 * an endpoint belongs to.
 *
 * Over the cap this throws RETRYABLE with a Retry-After to the window reset:
 * a legitimate burst backs off and drains, a sustained flood dead-letters
 * after the outbox's max attempts.
 */
export async function assertDispatchBudget({
  scopeId,
  label,
}: {
  scopeId: string;
  label: string;
}): Promise<void> {
  const limit = await rateLimit({
    key: `webhook-dispatch:${scopeId}`,
    windowSeconds: 3600,
    max: WEBHOOK_DISPATCH_HOURLY_CAP,
  });
  if (limit.allowed) return;
  throw new DispatchError({
    message: `${label}: webhook dispatch cap (${WEBHOOK_DISPATCH_HOURLY_CAP}/hour) reached — backing off.`,
    retryable: true,
    retryAfterMs: Math.max(0, limit.resetAt - Date.now()),
  });
}
