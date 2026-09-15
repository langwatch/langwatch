/** Billing enums restated (not imported) to keep enterprise deps off core-package
 * graphs; values match schema and enterprise-contract copies. */

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

export const SubscriptionStatus = {
  PENDING: "PENDING",
  FAILED: "FAILED",
  ACTIVE: "ACTIVE",
  CANCELLED: "CANCELLED",
} as const;

export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const Currency = { USD: "USD", EUR: "EUR" } as const;

export type Currency = (typeof Currency)[keyof typeof Currency];

export const PricingModel = { TIERED: "TIERED", SEAT_EVENT: "SEAT_EVENT" } as const;

export type PricingModel = (typeof PricingModel)[keyof typeof PricingModel];
