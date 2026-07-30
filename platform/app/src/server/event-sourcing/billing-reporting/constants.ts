/**
 * Shared tuning constants for the billing-reporting pipeline (ADR-098,
 * ADR-100). Centralised so the meter, the poke, the sweep and the dispatch
 * options agree on the same numbers rather than each hand-copying them.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

export const BILLING_REPORTING_PIPELINE_NAME = "billing_reporting" as const;

/**
 * Days into a new month during which the previous month is still reported,
 * so events that arrive late still land on the invoice they belong to.
 *
 * Shared by the two triggers deliberately: the per-event poke and the
 * scheduled sweep must agree on when a month stops being reportable, or the
 * sweep would keep re-reading a month the poke has already abandoned (or the
 * reverse).
 */
export const BILLING_GRACE_PERIOD_DAYS = 3;

/**
 * How long a staged report waits before it runs, so a burst of pokes
 * collapses onto one Stripe read rather than one per event.
 */
export const REPORT_DEBOUNCE_MS = 300_000;

/**
 * The dedup window a future dispatcher must hold `reportUsageForMonth`'s
 * group key open for (see `reporting/dispatchOptions.ts`'s
 * `reportUsageForMonthGroupKey` — a `partition` scope of `[organizationId,
 * billingMonth]`), paired with `extend: false`. Longer than the debounce so
 * the key still points at the staged job when that job comes due, rather
 * than expiring first and letting a second job stage for the same window.
 */
export const REPORT_DEDUP_TTL_MS = 310_000;

/**
 * The poke's own dedup window. One job per project per five minutes, which
 * is the whole reason a per-event subscriber is affordable behind the
 * busiest event in the product.
 */
export const POKE_DEDUP_TTL_MS = 300_000;

/**
 * Hourly. The per-event poke is the fast path and already collapses to one
 * dispatch per project per five minutes, so the sweep exists only for the
 * cases the poke structurally cannot cover: a poke whose dispatch failed
 * every retry, and an organization whose last billable event of the month is
 * its last event ever (nothing pokes again, so nothing re-reads the total).
 */
export const BILLING_METER_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Maximum consecutive failures before the self-dispatch convergence loop trips its circuit-breaker. */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** Stripe meter event name for billable events. */
export const BILLABLE_EVENTS_STRIPE_METER_EVENT_NAME = "langwatch_billable_events";

/**
 * One kill switch for every mount of the poke, regardless of which pipeline
 * it sits on. Spelled as the poke's own home ("billing_report") rather than
 * any pipeline it happens to be mounted on, because none of those pipelines
 * is more the poke's owner than the others — an operator stopping billing
 * pokes during an incident must not have to find and flip four separate
 * flags.
 */
export const BILLING_METER_POKE_KILL_SWITCH_KEY =
  "es-billing_report-subscriber-billingMeterPoke-killswitch" as const;
