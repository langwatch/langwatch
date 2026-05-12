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
