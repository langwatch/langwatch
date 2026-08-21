/**
 * The typing behind declared permission checks (ADR-092 decision 25).
 *
 * The registry already states, per resource, the tiers it can be granted at.
 * Everything here derives from that one object, so a declaration surface —
 * the tRPC builder, the Hono policy, the imperative facade — can be checked
 * against the input it reads its scope from. The tier vocabulary itself comes
 * from `./vocabulary`; this module adds no spelling of its own.
 *
 * Client-safe by the same rule as the registry: no Prisma, no env, no server
 * imports.
 *
 * A declaration that fails validation resolves to `DeclarationError<Reason>`,
 * so the assignability failure the author reads names the problem in words
 * rather than a wall of conditional types.
 */
import {
  AUTHZ_RESOURCES,
  type AuthzPermission,
  type AuthzResource,
} from "./registry";
import {
  BINDING_SCOPE_TIERS,
  type BindingScopeTier,
  SCOPE_TIER_BY_FIELD,
  SCOPE_TIER_FIELDS,
  type ScopeTierField,
} from "./vocabulary";

export type { BindingScopeTier, ScopeTierField };
export { SCOPE_TIER_BY_FIELD, SCOPE_TIER_FIELDS };

/** The tiers a resource declares, as the registry wrote them. */
type TiersOf<P extends AuthzPermission> =
  P extends `${infer R}:${string}`
    ? R extends AuthzResource
      ? (typeof AUTHZ_RESOURCES)[R]["scopes"][number]
      : never
    : never;

/** The input-addressable tiers permission P can be granted at. Platform-only
 *  permissions resolve to `never` and are refused by every surface. */
export type PermissionGrantTiers<P extends AuthzPermission> = Extract<
  TiersOf<P>,
  BindingScopeTier
>;

/** Permissions grantable only at the platform tier (`ops:*`). */
export type PlatformTierPermission = {
  [P in AuthzPermission]: "platform" extends TiersOf<P> ? P : never;
}[AuthzPermission];

/** Scope-tier fields present in input I at all (optional counts). */
type FieldsIn<I> = Extract<keyof I, ScopeTierField>;

/** The tiers I is guaranteed to carry an id for — required, not optional. */
type RequiredTiersIn<I> = {
  [K in FieldsIn<I>]: I extends Record<K, string>
    ? (typeof SCOPE_TIER_BY_FIELD)[K]
    : never;
}[FieldsIn<I>];

/**
 * The brand a failed declaration resolves to. Never constructed — its only
 * job is to carry `Reason` into the assignability diagnostic.
 */
export type DeclarationError<Reason extends string> = {
  readonly "Permission declaration error": Reason;
};

/** Unconstrained on purpose: with a still-generic P, `PermissionGrantTiers<P>`
 *  stays deferred and no `extends` constraint can apply to it, so the
 *  conditional does the narrowing and the result still interpolates into the
 *  template-literal diagnostics below. */
type FieldsForTiers<T> = T extends BindingScopeTier
  ? (typeof SCOPE_TIER_FIELDS)[T]
  : never;

/**
 * One input shape (never a union — the caller distributes) against one
 * permission. Platform-tier permissions are refused outright: the operator
 * middleware owns them and they resolve a scope no procedure input carries.
 * Otherwise at least one tier the permission allows must be REQUIRED by the
 * input, so the runtime always has an id. An id from a tier the permission
 * cannot be granted at is fine alongside an allowed one — inputs routinely
 * carry child-tier ids as payload, and the runtime reads only allowed tiers.
 */
type ValidateOne<P extends AuthzPermission, I> = [P] extends [
  PlatformTierPermission,
]
  ? DeclarationError<`'${P}' is platform-tier: declare it through the operator middleware, not a scoped input`>
  : [Extract<RequiredTiersIn<I>, PermissionGrantTiers<P>>] extends [never]
    ? DeclarationError<`'${P}' needs a required '${FieldsForTiers<PermissionGrantTiers<P>>}' in the procedure input`>
    : P;

/**
 * What the declaration surfaces intersect with their permission parameter:
 * P when every member of the (possibly union) input validates, the branded
 * error otherwise. `P & error` is uninhabited, so the call site fails with
 * the reason in its diagnostic.
 */
export type ValidatePermissionForInput<P extends AuthzPermission, I> = [
  I,
] extends [never]
  ? DeclarationError<"the procedure declares no input to read a scope id from — call .input() first">
  : I extends unknown
    ? ValidateOne<P, I>
    : never;

/**
 * The fields a `via` derivation may name for P: required in the input, and
 * of a tier narrower than one P is grantable at. A field whose own tier
 * already satisfies P is excluded — plain `.permission(p)` covers it without
 * ceremony. Narrower means earlier in `BINDING_SCOPE_TIERS`, which is
 * ordered most specific first, and a narrower id always resolves its
 * ancestors.
 */
export type ViaFieldFor<P extends AuthzPermission, I> = [P] extends [
  PlatformTierPermission,
]
  ? never
  : I extends unknown
    ? {
        [K in Extract<keyof I, ScopeTierField>]: I extends Record<K, string>
          ? (typeof SCOPE_TIER_BY_FIELD)[K] extends PermissionGrantTiers<P>
            ? never
            : K
          : never;
      }[Extract<keyof I, ScopeTierField>]
    : never;

/**
 * Options for a no-permission declaration over input I. Every scope-tier
 * field the input carries must be individually allowed with a written
 * reason — the compile-time form of the legacy `skipPermissionCheck` guard.
 */
/**
 * The access declaration any HTTP-surface endpoint must carry: exactly one
 * of a registry permission or an explicit opt-out with a written reason.
 *
 * The `undefined` counterkeys make the union exclusive, and a config
 * carrying neither matches neither arm — so "forgot to declare" is a compile
 * error at the registration call, not a route that mounts with service-level
 * auth only and reads as guarded. Frameworks that adopt it re-check at boot
 * (`@langwatch/api` refuses to build on a bare or blank-reason endpoint), so
 * a JS-level bypass of the types refuses to start.
 */
export type AccessDeclaration =
  | { permission: AuthzPermission; noPermission?: undefined }
  | {
      permission?: undefined;
      /** Why this endpoint deliberately runs without a permission check. */
      noPermission: { reason: string };
    };

export type NoPermissionOptions<I> = I extends unknown
  ? [FieldsIn<I>] extends [never]
    ? { reason: string; allow?: undefined }
    : {
        reason: string;
        /** Why each scope id in the input is safe to accept unchecked. */
        allow: { [K in FieldsIn<I>]: string };
      }
  : never;

/**
 * The scope argument an IMPERATIVE check takes for P: exactly one id, at a
 * tier the permission is grantable at. The `undefined` counterkeys make the
 * union exclusive, so passing two ids is a compile error, as is an id from a
 * tier the registry does not list. Platform-tier permissions collapse to
 * `never` and the call is unwritable.
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

// The same rules at runtime, so the middleware agrees with the types.

/** The input-addressable tiers `permission` can be granted at, narrowest first. */
export function permissionGrantTiers(
  permission: AuthzPermission,
): BindingScopeTier[] {
  const scopes = scopesOf(permission);
  return BINDING_SCOPE_TIERS.filter((tier) => scopes.includes(tier));
}

export function isPlatformTierPermission(permission: AuthzPermission): boolean {
  return scopesOf(permission).includes("platform");
}

function scopesOf(permission: AuthzPermission): readonly string[] {
  const resource = permission.split(":")[0] as AuthzResource;
  return AUTHZ_RESOURCES[resource]?.scopes ?? [];
}

export type DeclaredScopeId = { tier: BindingScopeTier; id: string };

/**
 * The scope a declared check runs at: the narrowest tier the permission is
 * grantable at whose id the input carries, or the `via` field's tier when
 * the declaration names one. Null when nothing usable is present — which the
 * types prevent, and the runtime treats as a wiring bug, not a denial.
 */
export function declaredScopeId({
  permission,
  input,
  via,
}: {
  permission: AuthzPermission;
  input: Partial<Record<ScopeTierField, unknown>>;
  via?: ScopeTierField;
}): DeclaredScopeId | null {
  if (via) {
    const id = input[via];
    return typeof id === "string" && id.length > 0
      ? { tier: SCOPE_TIER_BY_FIELD[via], id }
      : null;
  }
  for (const tier of permissionGrantTiers(permission)) {
    const id = input[SCOPE_TIER_FIELDS[tier]];
    if (typeof id === "string" && id.length > 0) return { tier, id };
  }
  return null;
}
