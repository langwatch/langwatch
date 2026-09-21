/**
 * The unit the Instant Evals meter is checkpointed in: ten-thousandths of a
 * dollar, so the running total is an integer and the value Stripe receives is
 * the dollar figure to four places, exactly.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { Temporal } from "@langwatch/time";

/** Stripe meter event name for Instant Evals, in dollars to four places. */
export const INSTANT_EVAL_USD_EVENT_NAME = "langwatch_instant_eval_usd";

/**
 * The request type Instant Evals write on the gateway spend ledger. A copy of
 * `INSTANT_EVAL_REQUEST_TYPE` in `@langwatch/instant-eval-contract`, which this
 * package does not yet depend on.
 */
export const INSTANT_EVAL_REQUEST_TYPE = "instant_eval";

export const INSTANT_EVAL_METER_UNITS_PER_USD = 10_000;

const NANO_USD_PER_USD = 1_000_000_000;

const NANO_USD_PER_METER_UNIT = NANO_USD_PER_USD / INSTANT_EVAL_METER_UNITS_PER_USD;

/** Nano-USD to meter units, truncated: a fraction of a unit is never billed. */
export function nanoUsdToInstantEvalMeterUnits(nanoUsd: number): number {
  return Math.floor(nanoUsd / NANO_USD_PER_METER_UNIT);
}

/** Meter units to the dollar value the meter event carries. */
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
