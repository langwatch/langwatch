/**
 * The unit the Instant Evals meter is checkpointed in: ten-thousandths of a
 * dollar, so the running total is an integer and the value Stripe receives is
 * the dollar figure to four places, exactly.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import { Temporal } from "@langwatch/time";

/** Stripe meter event name for Instant Evals, in dollars to four places. */
export const INSTANT_EVAL_USD_EVENT_NAME = "langwatch_instant_eval_usd";

const INSTANT_EVAL_METER_UNITS_PER_USD = 10_000;

const NANO_USD_PER_USD = 1_000_000_000;

const NANO_USD_PER_METER_UNIT = NANO_USD_PER_USD / INSTANT_EVAL_METER_UNITS_PER_USD;

/** Nano-USD to meter units, truncated: a fraction of a unit is never billed. */
export function nanoUsdToInstantEvalMeterUnits(nanoUsd: number): number {
  return Math.floor(nanoUsd / NANO_USD_PER_METER_UNIT);
}

/** Meter units to the dollar value the meter event carries. */
const METER_UNITS_PER_USD_CENT = INSTANT_EVAL_METER_UNITS_PER_USD / 100;

export function usdCentsToInstantEvalMeterUnits(cents: number): number {
  return Math.round(cents * METER_UNITS_PER_USD_CENT);
}

export function instantEvalMeterUnitsToUsd(units: number): number {
  return Number((units / INSTANT_EVAL_METER_UNITS_PER_USD).toFixed(4));
}

/** The half-open millisecond window a `YYYY-MM` billing month covers, in UTC. */
export function billingMonthWindowMs(billingMonth: string): { fromMs: number; toMs: number } {
  const [yearText, monthText] = billingMonth.split("-") as [string, string];
  const start = Temporal.PlainDate.from({
    year: Number.parseInt(yearText, 10),
    month: Number.parseInt(monthText, 10),
    day: 1,
  }).toZonedDateTime("UTC");

  return {
    fromMs: start.epochMilliseconds,
    toMs: start.add({ months: 1 }).epochMilliseconds,
  };
}

/**
 * When usage billing started for a month: the earliest start among growth-seat periods
 * overlapping it, so a replacement never moves it later (ADR-174 decision 23, proposed in v22).
 * No start reads the whole month; none overlapping, the first later start.
 */
export function usageBilledSinceInMonth({
  billingMonth,
  periods,
}: {
  billingMonth: string;
  periods: readonly { startMs: number | null; endMs: number | null }[];
}): { outcome: "whole_month" } | { outcome: "since"; startMs: number } {
  const month = billingMonthWindowMs(billingMonth);
  const overlapping = periods.filter(
    ({ startMs, endMs }) =>
      (endMs === null || endMs > month.fromMs) && (startMs === null || startMs < month.toMs),
  );
  if (overlapping.some(({ startMs }) => startMs === null)) return { outcome: "whole_month" };
  const startedLater = periods.filter(({ startMs }) => startMs !== null && startMs >= month.toMs);
  const starts = (overlapping.length > 0 ? overlapping : startedLater).flatMap(({ startMs }) =>
    startMs === null ? [] : [startMs],
  );

  return starts.length > 0
    ? { outcome: "since", startMs: Math.min(...starts) }
    : { outcome: "whole_month" };
}

/**
 * The window the Instant Evals meter reads: the month, from the later of its start and the
 * usage-billed subscription's start, so free use before an upgrade is never invoiced (ADR-174
 * decision 23, proposed in v22). A month that ended before the subscription started covers none.
 */
export function instantEvalWindowMs({
  billingMonth,
  usageBilledSinceMs,
}: {
  billingMonth: string;
  usageBilledSinceMs: number | null;
}): { fromMs: number; toMs: number } {
  const month = billingMonthWindowMs(billingMonth);
  if (usageBilledSinceMs === null) return month;

  return {
    fromMs: Math.min(Math.max(month.fromMs, usageBilledSinceMs), month.toMs),
    toMs: month.toMs,
  };
}

/**
 * The deterministic idempotency key for one Instant Evals delta. Its own
 * shape, and not the events meter's, so two meters converging on the same
 * numbers never share an identifier.
 */
export function instantEvalMeterIdentifier({
  organizationId,
  billingMonth,
  lastReportedTotal,
  targetTotal,
}: {
  organizationId: string;
  billingMonth: string;
  lastReportedTotal: number;
  targetTotal: number;
}): string {
  return `${organizationId}:${billingMonth}:${INSTANT_EVAL_USD_EVENT_NAME}:from:${lastReportedTotal}:to:${targetTotal}`;
}
