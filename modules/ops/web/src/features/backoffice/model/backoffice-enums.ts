/**
 * The billing vocabularies the Backoffice's editors offer, as option lists.
 *
 * `platform/app` read all four off `~/generated/prisma/client`, which a browser
 * package may not name. Three of them are also published by
 * `@langwatch/enterprise-billing-contract` — and that is where they should come
 * from, except that `@langwatch/ops-web` is a CORE package and a core package
 * may not depend on an enterprise one. That direction is structural rather than
 * stylistic: an enterprise import here would put the commercial plan catalogue
 * on the import graph of every open-source build of the Ops workspace.
 *
 * So the values are restated, and they are restated as the schema writes them
 * (`packages/prisma-client/prisma/schema.prisma`) — which is the same promise
 * the enterprise contract makes about its own copy ("Values must stay aligned
 * with Prisma enums"). Nothing here is a policy: these are the strings the
 * dropdowns list and the badges colour by.
 *
 * The alternative, and the reason this is not it: taking three from the
 * enterprise contract and restating only `PricingModel` — which has no contract
 * at all — would mean two sources for one form and an enterprise edge as well.
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
