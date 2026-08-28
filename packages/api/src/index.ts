// ---------------------------------------------------------------------------
// @langwatch/api -- the transport-agnostic half
//
// Everything here is true of a LangWatch API call whatever carries it: the
// error vocabulary and its wire envelope, the access-policy vocabulary that
// says what credential an operation accepts, the capability ports, and the
// Standard Schema boundary. None of it imports a transport framework.
//
// The Hono service framework is `@langwatch/api/rest`; the tRPC root and its
// policy middleware are `@langwatch/api/trpc`. Neither is re-exported here on
// purpose: a consumer that wants a transport names it.
// ---------------------------------------------------------------------------

export {
  AuthenticatedActorRequiredError,
  ApiVersionConflictError,
  createErrorHandler,
  formatError,
  ProjectInputMismatchError,
  InvalidApiVersionError,
} from "./errors.js";

export type { RateLimiter, ResponseCache } from "./ports.js";

export type { ApiSchema, ApiSchemaOutput } from "./schema.js";

// ---------------------------------------------------------------------------
// The access-policy vocabulary: what credential an operation accepts, and what
// that credential can reach. Read by the REST route registry, the OpenAPI
// security generator and the authorization audit alike, so it belongs to no
// one transport.
// ---------------------------------------------------------------------------

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
} from "./access-policy.js";
