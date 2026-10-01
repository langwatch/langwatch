// @langwatch/api/access -- the three access decisions both transports call.
// Neither runtime decides anything here itself: `decide` is the one check, and
// the permission vocabulary it reads belongs to `@langwatch/authorization`.

export {
  AccessWiringError,
  AuthenticationRequiredError,
  anyAuthenticated,
  assertRouteScopePermission,
  declareAccessMiddleware,
  decide,
  decideEntitlement,
  deferredScope,
  optionalCredential,
  publicRoute,
  routeScopeOf,
  SCOPE_INPUT_FIELDS,
  securityRequirement,
  sharedGrantTiers,
  type AccessActor,
  type AccessDecision,
  type AccessDeclaration,
  type AccessDenial,
  type ApiEntitlement,
  type AuthenticatedRouteAccess,
  type Authorize,
  type Caller,
  type Credential,
  type DeferredScopeAccess,
  type Entitlements,
  type OptionalCredentialAccess,
  type PermissionAllDeclaration,
  type PublicRouteAccess,
  type RouteAccess,
} from "./access.ts";
export { resolveDeclaredScope } from "./declaration.ts";
export {
  AUTHZ_DECLARATION,
  declareAuthzMiddleware,
  findAuthzDeclaration,
  type AuthzDeclaration,
  type DeclaredAuthzMiddleware,
  type EnforcedScopeFields,
} from "./declared-middleware.ts";
