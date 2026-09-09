/**
 * The generated Prisma enums these screens name, restated.
 *
 * `~/generated/prisma/client` is the application's generated client and a
 * browser package may not reach it. Each value below is an ENUM the product
 * offers in a picker or compares a membership against, restated with the
 * alignment obligation `@langwatch/enterprise-billing-contract` states about
 * its own Prisma enum copies: these must stay identical to
 * `packages/prisma-client/prisma/schema.prisma` or a role stops matching and a
 * scope stops resolving.
 *
 * `@langwatch/trace-web` carries the same three, byte for byte, and for the
 * same reason — no contract publishes the enum VALUES today. Both die when one
 * does.
 */

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
  /**
   * The role a CUSTOM role binding stores.
   *
   * The role picker offers built-in roles and custom ones side by side, and a
   * custom pick stores this plus the custom role's id. `@langwatch/trace-web`'s
   * copy of this enum omits it because nothing there reads it; this one needs
   * it, which is exactly the drift a shared contract would settle.
   */
  CUSTOM: "CUSTOM",
} as const;
export type TeamUserRole = (typeof TeamUserRole)[keyof typeof TeamUserRole];

export const RoleBindingScopeType = {
  ORGANIZATION: "ORGANIZATION",
  TEAM: "TEAM",
  PROJECT: "PROJECT",
  PLATFORM: "PLATFORM",
} as const;
export type RoleBindingScopeType = (typeof RoleBindingScopeType)[keyof typeof RoleBindingScopeType];
