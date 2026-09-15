/**
 * Prisma enums restated; must align with schema.prisma or matching fails.
 * Currency omitted; billing contract publishes it.
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
export type OrganizationUserRole = (typeof OrganizationUserRole)[keyof typeof OrganizationUserRole];

export const TeamUserRole = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;
export type TeamUserRole = (typeof TeamUserRole)[keyof typeof TeamUserRole];
