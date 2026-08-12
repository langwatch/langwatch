/**
 * @langwatch/authz — the unified authorization engine (ADR-092).
 *
 * This package is the PURE half of the design: the permission registry, the
 * built-in roles, the decide() walk, and the witness/passport primitives.
 * It reads nothing and writes nothing — no Prisma, no env, no server
 * imports — so the client (useCan), the app's server adapters, and any
 * future service can all depend on it. The storage half (collector, cache,
 * epoch, grants, shadow, tRPC middleware) lives in the app at
 * `src/server/authz/` and feeds CollectedGrants snapshots in.
 */
export {
  decide,
  decideWithCeiling,
  explain,
  scopeChain,
  scopeOrganizationId,
} from "./engine";
export type {
  AuthzDecision,
  AuthzDenialReason,
  AuthzGrantVia,
  AuthzPrincipalRef,
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  GrantAudience,
  LegacyTeamMembership,
  ResourceGrant,
  RoleBindingScopeType,
  TeamUserRole,
} from "./engine";
export {
  ALL_PERMISSIONS,
  AUTHZ_RESOURCES,
  bindingScopeCanGrantPermission,
  isRegistryPermission,
  permissionIndex,
  permissionResource,
  permissionSatisfiedBy,
  SHAREABLE_RESOURCE_KINDS,
} from "./registry";
export type {
  AuthzPermission,
  AuthzResource,
  AuthzScopeType,
  ShareableResourceKind,
} from "./registry";
export {
  builtinRoleGrants,
  builtinRolePermissions,
  roleKeyForTeamRole,
} from "./roles";
export type { BuiltinRoleKey } from "./roles";
export { PermissionDeniedError } from "./errors";
export { mintWitness } from "./witness";
export type { Authorized } from "./witness";
export {
  bitsetFromBase64Url,
  bitsetHasPermission,
  bitsetToBase64Url,
  encodePermissionBitset,
} from "./bitset";
export {
  MAX_PASSPORT_TTL_SECONDS,
  mintPassport,
  verifyPassport,
} from "./passport";
export type { PassportPayload, PassportVerification } from "./passport";
