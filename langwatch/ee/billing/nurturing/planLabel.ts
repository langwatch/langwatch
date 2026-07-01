import { PlanTypes, isAnnualTieredPlan } from "../planTypes";
import { isGrowthSeatEventPlan } from "../utils/growthSeatEvent";

/**
 * The lifecycle-default Customer.io plan label. Every person/org starts here at
 * signup and reverts here when no non-cancelled subscription remains.
 */
export const CIO_FREE_PLAN = "free";

/**
 * Maps an internal subscription plan type to the `plan` attribute value pushed
 * to Customer.io, so marketing segments key off a stable lifecycle vocabulary.
 *
 * Rules (per product decision):
 *   - No plan / FREE                  -> "free"
 *   - Go-forward Growth seat-event    -> raw plan type, verbatim
 *                                        (GROWTH_SEAT_USD_MONTHLY, GROWTH_SEAT_EUR_ANNUAL, ...)
 *                                        keeps currency + interval granularity.
 *   - Legacy/grandfathered paid plans -> bucketed by billing interval into the
 *     (LAUNCH/ACCELERATE/GROWTH/PRO,    seat-event lifecycle labels, so older
 *      ENTERPRISE, ...)                 cohorts fold into the same monthly/annual
 *                                        nurture tracks as new customers.
 *
 * Interval bucketing: annual when the plan is a known annual-tiered plan or its
 * name carries the ANNUAL suffix; monthly otherwise (the safe default — paid but
 * interval-less plans like ENTERPRISE land here and can be refined later).
 */
export function resolveCioPlanLabel(plan?: string | null): string {
  if (!plan || plan === PlanTypes.FREE) return CIO_FREE_PLAN;

  // Current seat-event plans carry full granularity straight through.
  if (isGrowthSeatEventPlan(plan)) return plan;

  // Legacy/other paid plans collapse into the interval buckets.
  const isAnnual = isAnnualTieredPlan(plan) || /ANNUAL$/.test(plan);
  return isAnnual ? "seat_event_annual" : "seat_event_monthly";
}
