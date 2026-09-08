// @langwatch/api/access -- the three access decisions both transports call.
// Neither runtime decides anything here itself: `decide` is the one check, and
// the permission vocabulary it reads belongs to `@langwatch/authz-contract`.

export {
  AccessWiringError,
  AuthenticationRequiredError,
  anyAuthenticated,
  assertRouteScopePermission,
  decide,
  deferredScope,
  optionalCredential,
  publicRoute,
  routeScopeOf,
  SCOPE_INPUT_FIELDS,
  securityRequirement,
  type AccessActor,
  type AccessDecision,
  type AccessDeclaration,
  type AccessDenialPort,
  type AuthenticatedRouteAccess,
  type AuthorizePort,
  type Caller,
  type Credential,
  type DeferredScopeAccess,
  type OptionalCredentialAccess,
  type PublicRouteAccess,
  type RouteAccess,
} from "./access.ts";
