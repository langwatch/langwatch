import { Cron } from "croner";

/**
 * ADR-044 §4 "Representation & nextRunAt computation": compute the next fire
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

/**
 * A defensive bound on the catch-up walk (`computeCatchUp`). At the report
 * scheduler's ≥15-minute minimum cadence a walk of this length spans months, so
 * it never trips in practice — it exists only so a pathological/misconfigured
 * cron cannot spin the recovery loop unbounded.
 */
const MAX_CATCH_UP_STEPS = 10_000;

/**
 * ADR-044 §4 "Missed-run / catch-up policy" (`runLatest`, the recommended
 * default and the only policy this scheduler ships). After an outage a job's
 * `nextRunAt` is the OLDEST un-fired slot. Firing that and advancing one cron
 * step at a time would replay EVERY missed slot — a week-long outage of a daily
 * report would send seven stale reports, a 15-minute report hundreds. That is
 * exactly the stampede the ADR forbids ("the scheduler never replays every
 * missed slot").
 *
 * Given the slot a fresh fire came due for (`slot`) and the current time,
 * compute the `runLatest` outcome:
 *  - `catchUpSlot` — the MOST RECENT missed slot (the newest cron instant at or
 *    before `now`), so the single catch-up covers the latest window rather than
 *    a week-old one. On an on-time fire (no backlog) this collapses back to
 *    `slot`, so the fast path is unchanged.
 *  - `nextRunAt` — the first cron instant strictly AFTER `now`, so once the one
 *    catch-up fires the calendar resumes in the future and the row is never
 *    re-served for a past slot.
 *
 * Pure (no I/O): one `Cron` is built and walked forward, so the whole
 * recovery costs a single parse regardless of backlog depth.
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
