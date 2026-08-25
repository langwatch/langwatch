/**
 * Plan and subscription status values shared across SaaS billing runtime.
 * Values must stay aligned with Prisma enums.
 */
export const PlanTypes = {
  FREE: "FREE",
  PRO: "PRO",
  GROWTH: "GROWTH",
  GROWTH_SEAT_EUR_MONTHLY: "GROWTH_SEAT_EUR_MONTHLY",
  GROWTH_SEAT_EUR_ANNUAL: "GROWTH_SEAT_EUR_ANNUAL",
  GROWTH_SEAT_USD_MONTHLY: "GROWTH_SEAT_USD_MONTHLY",
  GROWTH_SEAT_USD_ANNUAL: "GROWTH_SEAT_USD_ANNUAL",
  ENTERPRISE: "ENTERPRISE",
  LAUNCH: "LAUNCH",
  ACCELERATE: "ACCELERATE",
  LAUNCH_ANNUAL: "LAUNCH_ANNUAL",
  ACCELERATE_ANNUAL: "ACCELERATE_ANNUAL",
} as const;

export type PlanTypes = (typeof PlanTypes)[keyof typeof PlanTypes];

export const GROWTH_SEAT_PLAN_TYPES = [
  PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
  PlanTypes.GROWTH_SEAT_EUR_ANNUAL,
  PlanTypes.GROWTH_SEAT_USD_MONTHLY,
  PlanTypes.GROWTH_SEAT_USD_ANNUAL,
] as const;

const ANNUAL_TIERED_PLANS = new Set<PlanTypes>([
  PlanTypes.LAUNCH_ANNUAL,
  PlanTypes.ACCELERATE_ANNUAL,
]);

/** Type guard: returns true for tiered plans billed annually. */
export const isAnnualTieredPlan = (plan: string): boolean =>
  ANNUAL_TIERED_PLANS.has(plan as PlanTypes);

export const SUBSCRIBABLE_PLANS = [
  PlanTypes.FREE,
  PlanTypes.PRO,
  PlanTypes.GROWTH,
  PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
  PlanTypes.GROWTH_SEAT_EUR_ANNUAL,
  PlanTypes.GROWTH_SEAT_USD_MONTHLY,
  PlanTypes.GROWTH_SEAT_USD_ANNUAL,
  PlanTypes.LAUNCH,
  PlanTypes.ACCELERATE,
  PlanTypes.LAUNCH_ANNUAL,
  PlanTypes.ACCELERATE_ANNUAL,
] as const satisfies readonly PlanTypes[];

export const SubscriptionStatus = {
  PENDING: "PENDING",
  FAILED: "FAILED",
  ACTIVE: "ACTIVE",
  CANCELLED: "CANCELLED",
} as const;

export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/**
 * How plan resolution picks among an organization's active subscriptions:
 * newest contract wins, with the id as a total order so the same row answers
 * every time rather than whichever the database hands back first.
 *
 * Lives here, in a module with no imports of its own, so the query that
 * applies it and the report that explains it read the same rule instead of
 * restating it. `compareBySubscriptionOrder` is the in-memory reading of this
 * same list, for callers holding rows rather than issuing a query.
 */
export const ACTIVE_SUBSCRIPTION_ORDER_BY = [
  { createdAt: "desc" },
  { id: "desc" },
] as const;

/**
 * Orders already-fetched rows the way the database would.
 *
 * Relational comparison rather than `localeCompare`: Postgres orders text by
 * the column's collation, which for these ids is byte order, while ICU
 * collation can disagree on case and punctuation. The ids are lowercase
 * alphanumeric today, so the two agree, but that is a property of the current
 * id format rather than a guarantee.
 */
export function compareBySubscriptionOrder(
  a: { id: string; createdAt: Date },
  b: { id: string; createdAt: Date },
): number {
  for (const clause of ACTIVE_SUBSCRIPTION_ORDER_BY) {
    const [field, direction] = Object.entries(clause)[0] as ["createdAt" | "id", "desc"];
    const left = a[field];
    const right = b[field];
    const ascending = left < right ? -1 : left > right ? 1 : 0;
    const ordered = direction === "desc" ? -ascending : ascending;
    if (ordered !== 0) return ordered;
  }
  return 0;
}
