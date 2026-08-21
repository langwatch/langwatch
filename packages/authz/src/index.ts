/**
 * @langwatch/authz — the isomorphic authorization core (ADR-092).
 *
 * The frontend and the backend import this package verbatim, so it reads
 * nothing and writes nothing: no Prisma, no env, no node built-ins. That is
 * not a convention — the package's tsconfig declares no node types, so a
 * `node:crypto` import or a `Buffer` reference here does not compile.
 *
 *   @langwatch/authz         this package — the vocabulary, the permission
 *                            registry, the built-in roles and decide()
 *   @langwatch/authz-server  the server runtime: services over ports, the
 *                            event stream, the migration
 *   platform/app             the Prisma adapters and the composition root
 *
 * `./witness` is a subpath for encapsulation rather than safety: minting the
 * authorization brand is the server's job, so only the server runtime may
 * import the factory. The `Authorized` type is erased and stays here.
 */
export { AuthzEngine } from "./engine";
export { scopeChain, scopeOrganizationId } from "./scope";
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
} from "./types";
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
  declaredScopeId,
  isPlatformTierPermission,
  permissionGrantTiers,
  SCOPE_TIER_BY_FIELD,
  SCOPE_TIER_FIELDS,
} from "./declaration";
export type {
  AccessDeclaration,
  DeclaredScopeId,
  NoPermissionOptions,
  DeclarationError,
  PermissionGrantTiers,
  PermissionScopeArg,
  PlatformTierPermission,
  ScopeTierField,
  ValidatePermissionForInput,
  ViaFieldFor,
  TierOfScopeArg,
} from "./declaration";
export {
  builtinRoleGrants,
  builtinRolePermissions,
  roleKeyForTeamRole,
} from "./roles";
export type { BuiltinRoleKey } from "./roles";
export { PermissionDeniedError } from "./errors";
export type { Authorized } from "./witness";
export { bitsetHasPermission, encodePermissionBitset } from "./bitset";
export {
  BINDING_SCOPE_TIERS,
  CALLER_KINDS,
  isBindingScopeTier,
  isPrincipalKind,
  isScopeTier,
  isStoredPrincipalKind,
  isStoredScopeTier,
  PRINCIPAL_KIND_NAMES,
  PRINCIPAL_KINDS,
  PRINCIPAL_KIND_FROM_STORED,
  principalKindIsIdentified,
  SCOPE_TIER_FROM_STORED,
  SCOPE_TIER_NAMES,
  SCOPE_TIERS,
  STORED_PRINCIPAL_KIND,
  STORED_SCOPE_TIER,
} from "./vocabulary";
export type {
  BindingScopeTier,
  CallerKind,
  PrincipalKind,
  ScopeTier,
  StoredBindingScopeTier,
  StoredPrincipalKind,
  StoredScopeTier,
} from "./vocabulary";
export {
  AUTHZ_DECLARATION,
  authzDeclarationOf,
  declareAuthzMiddleware,
} from "./declared-middleware";
export type {
  AuthzDeclaration,
  DeclaredAuthzMiddleware,
  EnforcedScopeFields,
} from "./declared-middleware";
export { arbitrateClaims } from "./credential-claims";
export type {
  ClaimArbitration,
  CredentialClaim,
} from "./credential-claims";
