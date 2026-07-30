/**
 * The numbers the meter, the poke, the sweep and the dispatch options must
 * agree on.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

export const BILLING_REPORTING_PIPELINE_NAME = "billing_reporting" as const;

/** Days into a new month during which the previous month is still reported, so
 *  late events land on the invoice they belong to. Shared by both triggers: if
 *  they disagreed, the sweep would re-read a month the poke had abandoned. */
export const BILLING_GRACE_PERIOD_DAYS = 3;

/** How long a staged report waits, so a burst of pokes collapses onto one
 *  Stripe read. */
export const REPORT_DEBOUNCE_MS = 300_000;

/** Longer than the debounce, so the dedup key still points at the staged job
 *  when that job comes due rather than expiring first and letting a second job
 *  stage for the same window. */
export const REPORT_DEDUP_TTL_MS = 310_000;

/** One poke job per project per five minutes — the reason a per-event
 *  subscriber is affordable behind the busiest event in the product. */
export const POKE_DEDUP_TTL_MS = 300_000;

/** Hourly. The poke is the fast path; the sweep exists only for what the poke
 *  structurally cannot cover — a poke whose dispatch failed every retry, and an
 *  organization whose last billable event of the month is its last event. */
export const BILLING_METER_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Consecutive failures before the self-dispatch convergence loop trips its
 *  circuit-breaker. */
export const MAX_CONSECUTIVE_FAILURES = 5;

export const BILLABLE_EVENTS_STRIPE_METER_EVENT_NAME =
  "langwatch_billable_events";

/**
 * One kill switch for every mount of the poke. Spelled as the poke's own home
 * rather than any pipeline it is mounted on: an operator stopping billing
 * pokes during an incident must not have to find and flip four flags.
 */
export const BILLING_METER_POKE_KILL_SWITCH_KEY =
  "es-billing_report-subscriber-billingMeterPoke-killswitch" as const;
