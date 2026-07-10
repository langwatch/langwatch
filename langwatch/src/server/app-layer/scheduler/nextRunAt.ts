import { Cron } from "croner";

/**
 * ADR-042 §4 "Representation & nextRunAt computation": compute the next fire
 * from a cron expression evaluated in its IANA timezone, strictly after
 * `after`. Cron + timezone (not a relative window) is what makes "09:00 their
 * Monday" a wall-clock instant that tracks DST automatically — a spring-forward
 * or fall-back is resolved by evaluating the cron IN the zone, not as a fixed
 * offset. `croner` is the zero-dep, tz-native evaluator.
 *
 * Pure function (no I/O) so the loop can persist the result as an indexed
 * comparison instead of re-parsing every entry on every tick.
 */
export function computeNextRunAt({
  cron,
  timezone,
  after,
}: {
  cron: string;
  timezone: string;
  after: Date;
}): Date {
  const next = new Cron(cron, { timezone }).nextRun(after);
  if (!next) {
    // croner returns null for a pattern with no reachable future match
    // (e.g. "0 9 30 2 *" — Feb 30 never occurs). Surface it loudly rather
    // than silently persisting a bogus marker.
    throw new Error(
      `computeNextRunAt: cron "${cron}" (tz "${timezone}") has no run after ${after.toISOString()}`,
    );
  }
  return next;
}
