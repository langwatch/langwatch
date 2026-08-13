/**
 * @langwatch/authz — the unified authorization engine (ADR-092).
 *
 * The design is three layers, and this package is the innermost one: the
 * PURE core — the permission registry, the built-in roles, the decide()
 * walk, and the witness/bitset primitives. It reads nothing and writes
 * nothing (no Prisma, no env, no server imports), so the client (useCan),
 * the server runtime, and any future service all get the same answer.
 *
 *   @langwatch/authz         this package — vocabulary + AuthzEngine
 *   @langwatch/authz-server  the runtime services (AuthzService,
 *                            AuthzCollectorService, GrantsService,
 *                            AuthzShadowService) over repository INTERFACES
 *   platform/app             the Prisma repositories, the redis epoch store,
 *                            the tRPC middleware, and the composition root
 *                            (`src/server/authz/runtime.ts`) that wires them
 *
 * The services feed CollectedGrants snapshots into decide(); nothing in this
 * package ever reaches for storage itself.
 */
export { AuthzEngine, scopeChain, scopeOrganizationId } from "./engine";
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
export type { Authorized } from "./witness";
export { bitsetHasPermission, encodePermissionBitset } from "./bitset";
// Three things are deliberately NOT re-exported here, and the barrel stays
// browser-safe (useCan imports it) because of it:
//   - PassportService and the base64url bitset codecs
//     (bitsetToBase64Url / bitsetFromBase64Url) use node:crypto and Buffer —
//     server code imports "@langwatch/authz/passport".
//   - mintWitness is the one factory for the authorization brand — the
//     server runtime imports "@langwatch/authz/witness". The `Authorized`
//     TYPE stays here: it is erased, and every layer names it in signatures.
