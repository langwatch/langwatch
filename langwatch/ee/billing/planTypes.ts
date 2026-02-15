/**
 * Plan and subscription status values shared across SaaS billing runtime.
 * Values must stay aligned with Prisma enums.
 */
export const PlanTypes = {
  FREE: "FREE",
  PRO: "PRO",
  GROWTH: "GROWTH",
  ENTERPRISE: "ENTERPRISE",
  LAUNCH: "LAUNCH",
  ACCELERATE: "ACCELERATE",
  LAUNCH_ANNUAL: "LAUNCH_ANNUAL",
  ACCELERATE_ANNUAL: "ACCELERATE_ANNUAL",
} as const;

export type PlanTypes = (typeof PlanTypes)[keyof typeof PlanTypes];

export const SubscriptionStatus = {
  PENDING: "PENDING",
  FAILED: "FAILED",
  ACTIVE: "ACTIVE",
  CANCELLED: "CANCELLED",
} as const;

export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];
