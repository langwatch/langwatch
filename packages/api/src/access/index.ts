// @langwatch/api/access -- the three access decisions both transports call.
// Neither runtime decides anything here itself: `decide` is the one check, and
// the permission vocabulary it reads belongs to `@langwatch/authz-contract`.

export {
  AccessWiringError,
  AuthenticationRequiredError,
  decide,
  publicRoute,
  SCOPE_INPUT_FIELDS,
  securityRequirement,
  type AccessActor,
  type AccessDecision,
  type AccessDeclaration,
  type AccessDenialPort,
  type AuthorizePort,
  type Caller,
  type Credential,
  type PublicRouteAccess,
} from "./access.ts";
