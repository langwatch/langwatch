import { Cron } from "croner";

/**
 * Compute next fire from cron in its IANA timezone so wall-clock instants track
 * DST automatically. Pure function so results persist as indexed comparisons.
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

/**
 * A defensive bound on the catch-up walk (`computeCatchUp`). At the report
 * scheduler's ≥15-minute minimum cadence a walk of this length spans months, so
 * it never trips in practice — it exists only so a pathological/misconfigured
 * cron cannot spin the recovery loop unbounded.
 */
const MAX_CATCH_UP_STEPS = 10_000;

/**
 * Compute the runLatest catch-up outcome: fire only the most recent missed slot
 * to avoid replaying outages. Pure function costing a single parse.
 */
export function computeCatchUp({
  cron,
  timezone,
  slot,
  now,
}: {
  cron: string;
  timezone: string;
  slot: Date;
  now: Date;
}): { catchUpSlot: Date; nextRunAt: Date } {
  const schedule = new Cron(cron, { timezone });
  const nowMs = now.getTime();

  // Walk forward from the oldest missed slot to the newest one still <= now.
  let catchUpSlot = slot;
  for (let steps = 0; steps < MAX_CATCH_UP_STEPS; steps++) {
    const next = schedule.nextRun(catchUpSlot);
    if (!next || next.getTime() > nowMs) break;
    catchUpSlot = next;
  }

  // Advance strictly past `now` (or past the slot in the defensive slot-in-the-
  // future case) so the calendar resumes in the future — the "never replay"
  // guarantee. `nextRun` is exclusive of its argument, so this is always > now.
  const anchor = catchUpSlot.getTime() > nowMs ? catchUpSlot : now;
  const nextRunAt = schedule.nextRun(anchor);
  if (!nextRunAt) {
    throw new Error(
      `computeCatchUp: cron "${cron}" (tz "${timezone}") has no run after ${anchor.toISOString()}`,
    );
  }
  return { catchUpSlot, nextRunAt };
}
