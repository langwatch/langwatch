/**
 * Monthly events included in the Growth seat+event plan price.
 * Usage beyond this threshold triggers immediate Stripe invoicing
 * via billing_thresholds.usage_gte on the metered subscription item.
 *
 * This is NOT maxMessagesPerMonth (which controls trace blocking).
 * Traces continue flowing; only billing changes at the threshold.
 */
export const GROWTH_SEAT_INCLUDED_EVENTS = 200_000;

/**
 * Returns the billing_thresholds.usage_gte value for the events
 * subscription item on a Growth seat+event plan.
 */
export const getEventsUsageThreshold = (): number =>
  GROWTH_SEAT_INCLUDED_EVENTS;
