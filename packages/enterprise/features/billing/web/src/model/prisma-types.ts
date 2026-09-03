/**
 * The generated Prisma enums these screens name, restated.
 *
 * `~/generated/prisma/client` is the application's generated client and a
 * browser package may not reach it. Each value below is an ENUM the product
 * compares a membership or a pricing shape against, restated here with the
 * alignment obligation `@langwatch/enterprise-billing-contract` already states
 * about its own Prisma enum copies: these must stay identical to
 * `packages/prisma-client/prisma/schema.prisma` or a role stops matching and a
 * plan stops resolving.
 *
 * `Currency` is NOT here: the billing contract already publishes it, so naming
 * it a second time would be a second opinion about the same enum.
 */

export const PricingModel = {
  TIERED: "TIERED",
  SEAT_EVENT: "SEAT_EVENT",
} as const;
export type PricingModel = (typeof PricingModel)[keyof typeof PricingModel];

export const OrganizationUserRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  EXTERNAL: "EXTERNAL",
} as const;
export type OrganizationUserRole =
  (typeof OrganizationUserRole)[keyof typeof OrganizationUserRole];

export const TeamUserRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;
export type TeamUserRole = (typeof TeamUserRole)[keyof typeof TeamUserRole];
