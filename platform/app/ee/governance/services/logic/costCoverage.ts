// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Reading the key-to-bill mapping as of a day (ADR-128 §7).
 *
 * The mapping is dated, and this is what makes that worth anything: a chart of
 * last May resolves the bill that covered May, not the bill covering the key
 * today. Everything here is a pure function of periods and a day — no clock, no
 * database — so the same answer comes back however many times May is drawn.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */
import type { CoveragePeriod } from "../../repositories/ingestionSourceKeyCoverage.repository";

const MS_PER_DAY = 86_400_000;

/**
 * Whether an instant is the start of a UTC day.
 *
 * A day is the finest grain a bill can own — the rollup buckets spend with
 * `toStartOfDay` — so a mid-day effective instant is not representable, and a
 * noon re-point would file the whole day under whichever bill the read happened
 * to resolve.
 */
export function isUtcMidnight(at: Date): boolean {
  return at.getTime() % MS_PER_DAY === 0;
}

/** A calendar day, and nothing a `Date` constructor would rescue into one. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a string names a real calendar day.
 *
 * Both halves are load-bearing. The shape check rejects text `Date` would turn
 * into an Invalid Date, and the round-trip rejects a well-shaped day that does
 * not exist — `2026-06-31` parses happily and rolls forward to July the 1st, so
 * a chart asked for the 31st of June would quietly answer for a different day.
 */
export function isCalendarDay(day: string): boolean {
  if (!CALENDAR_DAY.test(day)) return false;
  const at = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(day);
}

/**
 * The UTC midnight that begins a `YYYY-MM-DD` day.
 *
 * Throws on anything else rather than returning an Invalid Date. Every
 * comparison against `NaN` is false, so an unchecked one would fall through
 * `coverageOnDay`'s two guards and read as *every* period covering the day —
 * a mapping nobody recorded, reported without a word. The caller-facing refusal
 * is `CoverageDayNotADateError`; this is the backstop under it.
 */
export function startOfUtcDay(day: string): Date {
  if (!isCalendarDay(day)) {
    throw new Error(`Coverage was asked for as of ${day}, which is not a day`);
  }
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Which bill covered each key on one day: key id to ingestion source id.
 *
 * A period covers a day when it began no later than that day's midnight and had
 * not yet ended by it — half-open, so a period ending on the first of June
 * covers May the 31st and not June the 1st, and its successor beginning at the
 * same instant covers June the 1st with no day claimed twice and none left out.
 *
 * A key absent from the returned map is *unmapped* on that day: its gateway
 * spend stands alone as metered, which is a different statement from zero.
 *
 * Throws when two bills both claim a key on one day. Nothing in the database
 * rules that out for a PAST day: the one-open-bill index counts only rows still
 * open, so overlapping CLOSED history is held off by the service's transaction
 * alone — it closes the open row and opens the successor at the same instant,
 * and never inserts a closed row directly. That makes this the check on that
 * transaction, not a formality, and the reason it is not a silent resolution:
 * keeping whichever period was read last is exactly the last-writer-wins
 * attribution the design exists to prevent. A plain error rather than a named
 * one — it means our own invariant broke, and nobody reading a chart can act on
 * it.
 */
export function coverageOnDay(params: {
  periods: readonly CoveragePeriod[];
  day: string;
}): Map<string, string> {
  const at = startOfUtcDay(params.day).getTime();
  const covering = new Map<string, string>();
  for (const period of params.periods) {
    if (period.validFrom.getTime() > at) continue;
    if (period.validTo !== null && period.validTo.getTime() <= at) continue;
    const claimed = covering.get(period.virtualKeyId);
    if (claimed !== undefined && claimed !== period.ingestionSourceId) {
      throw new Error(
        `Two ingestion sources cover gateway key ${period.virtualKeyId} on ${params.day}`,
      );
    }
    covering.set(period.virtualKeyId, period.ingestionSourceId);
  }
  return covering;
}
