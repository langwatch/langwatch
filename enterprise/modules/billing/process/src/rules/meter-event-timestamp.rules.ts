// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The timestamp a meter event may carry (ADR-156 section 7).
 *
 * The payment provider accepts a meter event only when its timestamp falls
 * inside the last 35 days. A month that was never reported can be older than
 * that and the amount is still owed, so it is reported at the time of
 * reporting instead. The event identifier names the period either way, which
 * is what keeps the line attributable on the invoice.
 */

/** How far back the meter accepts an event, in days. */
export const METER_EVENT_MAX_AGE_DAYS = 35;

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 24 * 60 * 60 * MS_PER_SECOND;
const METER_EVENT_MAX_AGE_MS = METER_EVENT_MAX_AGE_DAYS * MS_PER_DAY;

/**
 * The timestamp, in Unix seconds, for a meter event covering a period that
 * ended at `periodEndMs`.
 *
 * A period end in the future, or older than the accepted window, falls back to
 * `nowMs`: the event is then never refused for its timestamp and never dated
 * ahead of the report that produced it.
 */
export function meterEventTimestampSeconds({
  periodEndMs,
  nowMs,
}: {
  periodEndMs: number;
  nowMs: number;
}): number {
  const withinWindow = periodEndMs <= nowMs && nowMs - periodEndMs <= METER_EVENT_MAX_AGE_MS;

  return Math.floor((withinWindow ? periodEndMs : nowMs) / MS_PER_SECOND);
}

/** Whether a period that ended at `periodEndMs` is too old for the meter. */
export function isMeterEventTooOld({
  periodEndMs,
  nowMs,
}: {
  periodEndMs: number;
  nowMs: number;
}): boolean {
  return nowMs - periodEndMs > METER_EVENT_MAX_AGE_MS;
}
