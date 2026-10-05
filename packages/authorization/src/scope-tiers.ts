/**
 * Scope tiers, declared once: every union, conversion and guard derives from
 * these, so a misspelt tier is a type error. Also the tiers each permission
 * can be granted at, derived from the registry, and the declared scope id.
 */
import { z } from "zod";

import { AUTHZ_RESOURCES, type AuthzPermission, type AuthzResource } from "./registry.ts";

/**
 * The tiers a permission question can be asked at, narrowest first. Order is
 * containment: a grant at a later tier covers questions asked at an earlier
 * one, which is what `scopeChainFor` walks.
 */
export const SCOPE_TIERS = {
  resource: { stored: "RESOURCE" },
  project: { stored: "PROJECT", field: "projectId" },
  team: { stored: "TEAM", field: "teamId" },
  organization: { stored: "ORGANIZATION", field: "organizationId" },
  platform: { stored: "PLATFORM" },
} as const;

export const SCOPE_TIER_NAMES = Object.keys(SCOPE_TIERS) as readonly ScopeTier[];
export const scopeTierSchema = z.enum(
  Object.keys(SCOPE_TIERS) as [keyof typeof SCOPE_TIERS, ...(keyof typeof SCOPE_TIERS)[]],
);
export type ScopeTier = z.infer<typeof scopeTierSchema>;

export const storedScopeTierSchema = z.enum([
  "RESOURCE",
  "PROJECT",
  "TEAM",
  "ORGANIZATION",
  "PLATFORM",
]);
export type StoredScopeTier = z.infer<typeof storedScopeTierSchema>;

/**
 * The tiers a permission may be declared at. `resource` is excluded because a
 * resource is reached by a grant, not a declaration; `platform` because operator
 * access is not granted through an organization.
 */
export const DECLARED_SCOPE_TIERS = [
  "project",
  "team",
  "organization",
] as const satisfies readonly ScopeTier[];

export const declaredScopeTierSchema = z.enum(DECLARED_SCOPE_TIERS);
export type DeclaredScopeTier = z.infer<typeof declaredScopeTierSchema>;

/**
 * The input field naming each declared tier — the same three tiers, spelled
 * the way a procedure input spells them. Declared on the tiers above, not a
 * separate table, so a tier cannot have a field here and no spelling there.
 */
export const SCOPE_TIER_FIELDS = {
  project: SCOPE_TIERS.project.field,
  team: SCOPE_TIERS.team.field,
  organization: SCOPE_TIERS.organization.field,
} as const;

export type ScopeTierField = (typeof SCOPE_TIER_FIELDS)[DeclaredScopeTier];

/** The tier a scope field names — the reverse of SCOPE_TIER_FIELDS. */
export const SCOPE_TIER_BY_FIELD = {
  projectId: "project",
  teamId: "team",
  organizationId: "organization",
} as const satisfies Record<ScopeTierField, DeclaredScopeTier>;

export const STORED_SCOPE_TIER = Object.fromEntries(
  Object.entries(SCOPE_TIERS).map(([tier, spelling]) => [tier, spelling.stored]),
) as Record<ScopeTier, StoredScopeTier>;

export const SCOPE_TIER_FROM_STORED = Object.fromEntries(
  Object.entries(SCOPE_TIERS).map(([tier, spelling]) => [spelling.stored, tier]),
) as Record<StoredScopeTier, ScopeTier>;

// An own-property check, not `in`: an object literal inherits from
// Object.prototype, so `"constructor" in SCOPE_TIERS` is true and would
// narrow an untrusted string to a tier whose lookup then yields a function.
const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

export const isScopeTier = (value: unknown): value is ScopeTier =>
  typeof value === "string" && hasOwn(SCOPE_TIERS, value);

export const isStoredScopeTier = (value: unknown): value is StoredScopeTier =>
  typeof value === "string" && hasOwn(SCOPE_TIER_FROM_STORED, value);

export const isDeclaredScopeTier = (value: unknown): value is DeclaredScopeTier =>
  declaredScopeTierSchema.validate(value);

export const declaredScopeIdSchema = z.discriminatedUnion("tier", [
  z.object({ tier: z.literal("project"), id: z.string() }).strict(),
  z.object({ tier: z.literal("team"), id: z.string() }).strict(),
  z.object({ tier: z.literal("organization"), id: z.string() }).strict(),
]);
export type AuthzDeclaredScopeId = z.infer<typeof declaredScopeIdSchema>;

/** The tiers a resource declares, as the registry wrote them. */
type TiersOf<P extends AuthzPermission> = P extends `${infer R}:${string}`
  ? R extends AuthzResource
    ? (typeof AUTHZ_RESOURCES)[R]["scopes"][number]
    : never
  : never;

/** The input-addressable tiers permission P can be granted at. Platform-only
 *  permissions resolve to `never` and are refused by every surface. */
export type PermissionGrantTiers<P extends AuthzPermission> = Extract<
  TiersOf<P>,
  DeclaredScopeTier
>;

/** Permissions grantable only at the platform tier (`ops:*`). */
export type PlatformTierPermission = {
  [P in AuthzPermission]: "platform" extends TiersOf<P> ? P : never;
}[AuthzPermission];

/**
 * The scope argument an IMPERATIVE check takes for P: exactly one id, at
 * a grantable tier. `undefined` counterkeys make the union exclusive, so
 * two ids or an ungranted tier is a compile error; platform-tier is `never`.
 */
export type PermissionScopeArg<P extends AuthzPermission> =
  | ("project" extends PermissionGrantTiers<P>
      ? { projectId: string; teamId?: undefined; organizationId?: undefined }
      : never)
  | ("team" extends PermissionGrantTiers<P>
      ? { teamId: string; projectId?: undefined; organizationId?: undefined }
      : never)
  | ("organization" extends PermissionGrantTiers<P>
      ? { organizationId: string; projectId?: undefined; teamId?: undefined }
      : never);

/**
 * The tier a {@link PermissionScopeArg} value addressed — what the witness a
 * throwing check returns is scoped to.
 */
export type TierOfScopeArg<A> = A extends { projectId: string }
  ? "project"
  : A extends { teamId: string }
    ? "team"
    : "organization";

/** The input-addressable tiers `permission` can be granted at, narrowest first. */
export function permissionGrantTiers(permission: AuthzPermission): DeclaredScopeTier[] {
  const scopes = scopesOf(permission);
  return DECLARED_SCOPE_TIERS.filter((tier) => scopes.includes(tier));
}

export function isPlatformTierPermission(permission: AuthzPermission): boolean {
  return scopesOf(permission).includes("platform");
}

function scopesOf(permission: AuthzPermission): readonly string[] {
  const resource = permission.split(":")[0] as AuthzResource;
  return AUTHZ_RESOURCES[resource]?.scopes ?? [];
}
