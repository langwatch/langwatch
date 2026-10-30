import type { Event } from "../domain/types.ts";

/**
 * An event's applied-set token: its idempotency key, else its id. A history read keeps the first
 * row per key, so a set of ids could hold one no history read returns, and every re-fold would
 * report an incomplete history forever. Older sets hold ids; `appliedTokensOf` matches both.
 */
export function appliedTokenOf(event: Event): string {
  return event.idempotencyKey || event.id;
}
