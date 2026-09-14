import { Temporal, type Instant } from "@langwatch/time";
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

export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/**
 * Plan resolution picks newest contract; id breaks ties for stable results.
 * `compareBySubscriptionOrder` mirrors this for in-memory row ordering.
 */
export const ACTIVE_SUBSCRIPTION_ORDER_BY = [{ createdAt: "desc" }, { id: "desc" }] as const;

/**
 * Orders fetched rows as the database would; relational comparison, not
 * locale-aware, to match Postgres byte ordering of ids.
 */
export function compareBySubscriptionOrder(
  a: { id: string; createdAt: Instant },
  b: { id: string; createdAt: Instant },
): number {
  for (const clause of ACTIVE_SUBSCRIPTION_ORDER_BY) {
    const [field, direction] = Object.entries(clause)[0] as ["createdAt" | "id", "desc"];
    const ascending =
      field === "createdAt"
        ? Temporal.Instant.compare(a.createdAt, b.createdAt)
        : compareIds(a.id, b.id);
    const ordered = direction === "desc" ? -ascending : ascending;
    if (ordered !== 0) return ordered;
  }
  return 0;
}

/** Byte order, matching the collation Postgres reads these ids under. */
function compareIds(left: string, right: string): number {
  if (left < right) return -1;

  return left > right ? 1 : 0;
}
