/** Prisma enum values: must stay identical to schema or roles and scopes break. */

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
