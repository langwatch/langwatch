/**
 * ADR-092 delivery-plan PR 4 (decision 25) — the typing behind declared
 * permission checks. The registry already states, per resource, the scope
 * tiers it can be granted at; everything here derives from that one object so
 * a declaration surface (the tRPC builder, the Hono policy, the imperative
 * facade) can be checked against the input it reads its scope from.
 *
 * Client-safe by the same rule as the registry: no Prisma, no env, no server
 * imports. The runtime exports are pure functions over the registry.
 *
 * The compile-error channel is the `PermissionDeclarationError<…>` brand: a
 * declaration that fails validation resolves the parameter type to it, so the
 * assignability failure the author reads names the problem in its own words
 * instead of a wall of conditional types.
 */
import {
  AUTHZ_RESOURCES,
  type AuthzPermission,
  type AuthzResource,
} from "./registry";

/** The input field that names each grantable, input-addressable tier. */
export const SCOPE_TIER_FIELDS = {
  project: "projectId",
  team: "teamId",
  organization: "organizationId",
} as const;

/** "project" | "team" | "organization" — the tiers an input can address. */
export type InputScopeTier = keyof typeof SCOPE_TIER_FIELDS;

/** "projectId" | "teamId" | "organizationId". */
export type ScopeTierField = (typeof SCOPE_TIER_FIELDS)[InputScopeTier];

/** Most specific first — the order runtime scope extraction resolves in. */
export const SCOPE_TIER_ORDER = ["project", "team", "organization"] as const;

type TierOfField<F> = {
  [T in InputScopeTier]: F extends (typeof SCOPE_TIER_FIELDS)[T] ? T : never;
}[InputScopeTier];

type ResourceOfPermission<P extends string> = P extends `${infer R}:${string}`
  ? R extends AuthzResource
    ? R
    : never
  : never;

/**
 * The input-addressable tiers permission P can be granted at. Platform-tier
 * permissions have no input-addressable tier and resolve to `never` here —
 * they are refused by the declaration surfaces (see PlatformTierPermission).
 */
export type PermissionGrantTiers<P extends AuthzPermission> = Extract<
  (typeof AUTHZ_RESOURCES)[ResourceOfPermission<P>]["scopes"][number],
  InputScopeTier
>;

/** Permissions grantable only at the platform tier (`ops:*`). */
export type PlatformTierPermission = {
  [P in AuthzPermission]: "platform" extends (typeof AUTHZ_RESOURCES)[ResourceOfPermission<P>]["scopes"][number]
    ? P
    : never;
}[AuthzPermission];

/**
 * The tiers a KNOWN id can derive an ancestor scope for: a projectId resolves
 * its team and organization, a teamId its organization. `via` declarations
 * lean on this — the derivation is legal exactly when the named field's tier
 * sits at or below a tier the permission is grantable at.
 */
type DerivableTiers<T extends InputScopeTier> = T extends "project"
  ? "project" | "team" | "organization"
  : T extends "team"
    ? "team" | "organization"
    : "organization";

/** Scope-tier fields present in input I at all (optional counts). */
type TierFieldsIn<I> = Extract<keyof I, ScopeTierField>;

/** Scope-tier fields I REQUIRES (present and not undefined). */
type RequiredTierFieldsIn<I> = {
  [K in TierFieldsIn<I>]: I extends Record<K, string> ? K : never;
}[TierFieldsIn<I>];

/** The tiers of the fields present in I. */
type TiersPresentIn<I> = TierOfField<TierFieldsIn<I>>;

/** The tiers I is guaranteed to carry an id for. */
type TiersRequiredIn<I> = TierOfField<RequiredTierFieldsIn<I>>;

/**
 * The brand a failed declaration resolves to. Never constructed at runtime —
 * its only job is to carry `Reason` into the assignability diagnostic.
 */
export type PermissionDeclarationError<Reason extends string> = {
  readonly "Permission declaration error": Reason;
};

/**
 * Unconstrained on purpose: with a still-generic P, `PermissionGrantTiers<P>`
 * stays deferred and the compiler cannot apply an `extends InputScopeTier`
 * constraint to it — the conditional inside does the narrowing instead, which
 * also proves the result interpolates into the template-literal diagnostics.
 */
type FieldsForTiers<T> = T extends InputScopeTier
  ? (typeof SCOPE_TIER_FIELDS)[T]
  : never;

/**
 * One input shape (never a union — the caller distributes) checked against
 * one permission:
 *
 *  - platform-tier permissions are refused outright (the operator middleware
 *    owns them, and resolves a scope no procedure input carries);
 *  - at least one tier the permission allows must be REQUIRED by the input,
 *    so the runtime always has an id to resolve. An id from a tier the
 *    permission cannot be granted at is fine as long as an allowed one is
 *    there too — inputs routinely carry child-tier ids as PAYLOAD (a
 *    department's teamId under an organization-only check), and the runtime
 *    only ever reads the allowed tiers.
 */
type ValidateOneInput<
  P extends AuthzPermission,
  I,
> = [P] extends [PlatformTierPermission]
  ? PermissionDeclarationError<`'${P}' is platform-tier: declare it through the operator middleware, not a scoped input`>
  : [Extract<TiersRequiredIn<I>, PermissionGrantTiers<P>>] extends [never]
    ? PermissionDeclarationError<`'${P}' needs a required '${FieldsForTiers<PermissionGrantTiers<P>>}' in the procedure input`>
    : P;

/**
 * The validation the declaration surfaces intersect with their permission
 * parameter: resolves to P when every member of the (possibly union) input
 * shape validates, and to the branded error otherwise — `P & error` is
 * uninhabited, so the call site fails with the reason in the diagnostic.
 */
export type ValidatePermissionForInput<P extends AuthzPermission, I> = [
  I,
] extends [never]
  ? PermissionDeclarationError<"the procedure declares no input to read a scope id from — call .input() first">
  : I extends unknown
    ? ValidateOneInput<P, I>
    : never;

/**
 * The fields of I a `via` derivation may name for permission P: required in
 * the input, and of a tier that can derive a tier P is grantable at. The
 * derivation exists for the org-tier-permission-with-a-narrower-id case, so
 * fields whose own tier already satisfies P directly are excluded — plain
 * `.permission(p)` covers those without ceremony.
 */
export type ViaFieldFor<P extends AuthzPermission, I> = [P] extends [
  PlatformTierPermission,
]
  ? never
  : I extends unknown
    ? {
        [K in RequiredTierFieldsIn<I>]: TierOfField<K> extends PermissionGrantTiers<P>
          ? never
          : PermissionGrantTiers<P> extends DerivableTiers<TierOfField<K>>
            ? K
            : never;
      }[RequiredTierFieldsIn<I>]
    : never;

/**
 * Options for a no-permission declaration over input I. Every scope-tier
 * field the input carries must be individually allowed with a written reason
 * — the compile-time form of the legacy `skipPermissionCheck` runtime guard.
 */
export type NoPermissionOptions<I> = I extends unknown
  ? [TierFieldsIn<I>] extends [never]
    ? {
        /** Why this procedure needs no permission check. */
        reason: string;
        allow?: undefined;
      }
    : {
        reason: string;
        /**
         * Why each scope id in the input is safe to accept without a
         * permission check on it.
         */
        allow: { [K in TierFieldsIn<I>]: string };
      }
  : never;

/**
 * The scope argument an IMPERATIVE check takes for permission P: exactly one
 * id, at a tier the permission is grantable at. The `undefined`-optional
 * counterkeys make the union exclusive — passing two ids is a compile error,
 * as is an id from a tier the registry does not list for P. Platform-tier
 * permissions admit no scope id at all, so the argument collapses to `never`
 * and the call is unwritable.
 */
export type PermissionScopeArg<P extends AuthzPermission> =
  | ("project" extends PermissionGrantTiers<P>
      ? {
          projectId: string;
          teamId?: undefined;
          organizationId?: undefined;
        }
      : never)
  | ("team" extends PermissionGrantTiers<P>
      ? {
          teamId: string;
          projectId?: undefined;
          organizationId?: undefined;
        }
      : never)
  | ("organization" extends PermissionGrantTiers<P>
      ? {
          organizationId: string;
          projectId?: undefined;
          teamId?: undefined;
        }
      : never);

// ============================================================================
// Runtime mirrors — the same rules, for the middleware to agree with the types
// ============================================================================

const INPUT_TIERS: ReadonlySet<string> = new Set(SCOPE_TIER_ORDER);

/** The input-addressable tiers `permission` can be granted at, most specific first. */
export function permissionGrantTiers(
  permission: AuthzPermission,
): InputScopeTier[] {
  const resource = permission.split(":")[0] as AuthzResource;
  const scopes: readonly string[] = AUTHZ_RESOURCES[resource]?.scopes ?? [];
  return SCOPE_TIER_ORDER.filter((tier) => scopes.includes(tier)).filter(
    (tier): tier is InputScopeTier => INPUT_TIERS.has(tier),
  );
}

export function isPlatformTierPermission(permission: AuthzPermission): boolean {
  const resource = permission.split(":")[0] as AuthzResource;
  const scopes: readonly string[] = AUTHZ_RESOURCES[resource]?.scopes ?? [];
  return scopes.includes("platform");
}

export type DeclaredScopeId = {
  tier: InputScopeTier;
  id: string;
};

/**
 * The scope a declared check runs at: the most specific tier the permission
 * is grantable at whose id the input actually carries — or the `via` field's
 * tier when the declaration names one. Returns null when nothing usable is
 * present, which the types prevent and the runtime still treats as a wiring
 * bug rather than a denial.
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
    if (typeof id !== "string" || id.length === 0) return null;
    const tier = (
      Object.entries(SCOPE_TIER_FIELDS) as [InputScopeTier, ScopeTierField][]
    ).find(([, field]) => field === via)?.[0];
    return tier ? { tier, id } : null;
  }
  for (const tier of permissionGrantTiers(permission)) {
    const id = input[SCOPE_TIER_FIELDS[tier]];
    if (typeof id === "string" && id.length > 0) return { tier, id };
  }
  return null;
}
