// @langwatch/api — transport-agnostic half of the API; shared error vocabulary, access policies,
// capability ports, Standard Schema boundary. The Hono service framework is `@langwatch/api/rest`;
// tRPC root and policy middleware are `@langwatch/api/trpc`. Neither is re-exported here: a
// consumer that wants a transport names it.

export {
  AuthenticatedActorRequiredError,
  SurfaceBlankSecretError,
  SurfaceCapabilityUnavailableError,
  SurfaceUnconfiguredError,
  SurfaceUnverifiedError,
  OrganizationAuthenticationUnavailableError,
  OrganizationCredentialClassMismatchError,
  OrganizationInvalidCredentialsError,
  OrganizationMissingCredentialsError,
  OrganizationNotFoundForCredentialError,
  OrganizationPermissionError,
  ProjectInvalidCredentialsError,
  ProjectMissingCredentialsError,
  ApiVersionConflictError,
  createErrorHandler,
  EnterprisePlanRequiredError,
  formatError,
  ProjectInputMismatchError,
  InvalidApiVersionError,
  PayloadTooLargeError,
  ScopeInputMismatchError,
} from "./errors.ts";

export type { RateLimiter, ResponseCache, UpgradeHandler } from "./ports.ts";
export { ConnectUpgradeRouter } from "./ports.ts";
export { WebSocketHost, WebSocketProtocol, type ProtocolConnection } from "./websocket.ts";

export type { ApiSchema, ApiSchemaOutput } from "./schema.ts";

// The access-policy vocabulary: what credential an operation accepts, and what
// that credential can reach. Read by the REST route registry, the OpenAPI
// security generator and the authorization audit alike, so it belongs to no
// one transport.

export {
  type AccessPolicy,
  anyAuthenticated,
  apiKeyPermission,
  type CredentialClass,
  credentialClassFor,
  describeAccessPolicy,
  type HandlerCredential,
  handlerManagedAuth,
  internalSecret,
  isApiKeyReachable,
  policyPermissions,
  publicEndpoint,
  requires,
  requiresOnProject,
  requiresOnTeam,
} from "./access-policy.ts";

export { isInternalSecretValid } from "./rest/security.ts";
