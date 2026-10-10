/**
 * Derive type-safe declared permission checks from the registry's tier
 * declarations (ADR-092 decision 25); fail with readable type errors.
 */
import {
  SCOPE_TIER_BY_FIELD,
  SCOPE_TIER_FIELDS,
  permissionGrantTiers,
  type AuthzDeclaredScopeId,
  type AuthzPermission,
  type DeclaredScopeTier,
  type PermissionGrantTiers,
  type PlatformTierPermission,
  type ScopeTierField,
} from "@langwatch/authorization";

/** Scope-tier fields present in input I at all (optional counts). */
type FieldsIn<I> = Extract<keyof I, ScopeTierField>;

/** The tiers I is guaranteed to carry an id for — required, not optional. */
type RequiredTiersIn<I> = {
  [K in FieldsIn<I>]: I extends Record<K, string> ? (typeof SCOPE_TIER_BY_FIELD)[K] : never;
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
type FieldsForTiers<T> = T extends DeclaredScopeTier ? (typeof SCOPE_TIER_FIELDS)[T] : never;

/**
 * Validate one input against one permission; require at least one allowed
 * tier id (platform permissions are operator-middleware-only).
 */
type ValidateOne<P extends AuthzPermission, I> = [P] extends [PlatformTierPermission]
  ? DeclarationError<`'${P}' is platform-tier: declare it through the operator middleware, not a scoped input`>
  : [Extract<RequiredTiersIn<I>, PermissionGrantTiers<P>>] extends [never]
    ? DeclarationError<`'${P}' needs a required '${FieldsForTiers<PermissionGrantTiers<P>>}' in the procedure input`>
    : P;

/**
 * What the declaration surfaces intersect with their permission parameter:
 * P when the input validates, the branded error otherwise. `P & error` is
 * uninhabited, so the call site fails with the reason in its diagnostic.
 */
export type ValidatePermissionForInput<P extends AuthzPermission, I> = [I] extends [never]
  ? DeclarationError<"the procedure declares no input to read a scope id from — call .input() first">
  : I extends unknown
    ? ValidateOne<P, I>
    : never;

/**
 * Distinguish caller mistakes (blank field) from wiring bugs (absent field)
 * to avoid paging for malformed requests.
 */
export type UnresolvedDeclaredScope =
  | { reason: "blank"; field: ScopeTierField }
  | { reason: "absent" };

export type DeclaredScopeResolution =
  | { resolved: true; scope: AuthzDeclaredScopeId }
  | { resolved: false; unresolved: UnresolvedDeclaredScope };

const usableId = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * Whether the input asked the caller for this field at all. Guarded rather
 * than a bare `in`, which throws on the non-object input a bypassed type
 * layer could still hand us — the very case this whole path exists to survive.
 */
const namesField = (input: unknown, field: string): boolean =>
  typeof input === "object" && input !== null && field in input;

/**
 * Resolve to the narrowest allowed tier id present in input, or the `via`
 * field's tier; empty fields don't block wider filled tiers.
 */
export function resolveDeclaredScope({
  permission,
  input,
  via,
}: {
  permission: AuthzPermission;
  input: Partial<Record<ScopeTierField, unknown>>;
  via?: ScopeTierField;
}): DeclaredScopeResolution {
  const fields = via
    ? [via]
    : permissionGrantTiers(permission).map((tier) => SCOPE_TIER_FIELDS[tier]);

  // Normalized once before any field read: `input[field]` throws on `null`,
  // and a bypassed type layer can still hand us one - the same class of
  // bug as the blank id this module exists to survive.
  const named: Partial<Record<ScopeTierField, unknown>> =
    typeof input === "object" && input !== null ? input : {};

  for (const field of fields) {
    const id = named[field];
    if (usableId(id)) {
      return { resolved: true, scope: { tier: SCOPE_TIER_BY_FIELD[field], id } };
    }
  }

  // Named the field and left no usable id in it: the caller's mistake, not
  // ours. The narrowest such field is the one to name back, matching the tier
  // order the resolution walk itself prefers.
  const blank = fields.find((field) => namesField(named, field));
  return {
    resolved: false,
    unresolved: blank ? { reason: "blank", field: blank } : { reason: "absent" },
  };
}

/**
 * The resolved scope, or null when the input carries none. Kept for callers
 * that only need the answer and not the reason for its absence.
 */
export function findDeclaredScopeId({
  permission,
  input,
  via,
}: {
  permission: AuthzPermission;
  input: Partial<Record<ScopeTierField, unknown>>;
  via?: ScopeTierField;
}): AuthzDeclaredScopeId | null {
  const resolution = resolveDeclaredScope({ permission, input, via });
  return resolution.resolved ? resolution.scope : null;
}
