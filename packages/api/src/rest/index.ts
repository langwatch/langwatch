// @langwatch/api/rest -- the Hono service framework Versioned namespaces, the definition
// chain, the endpoint pipeline, SSE, and the route security spine every LangWatch REST
// family mounts on. The error vocabulary, the access-policy vocabulary, the capability
// ports and the schema boundary live at `@langwatch/api` and are NOT re-exported from
// here: a consumer imports each from the entry point that owns it.

// The fingerprint a credential refusal is logged with, on every family that
// resolves its own credential.
export { type AuthDiagnostics, collectAuthDiagnostics } from "./auth-diagnostics.ts";
// The wire-size cap every ingestion family carries. Here rather than in one
// family because nine of them apply it, and a second implementation would be a
// second answer to "how big is too big" on the same process.
export { bodyLimit, type BodyLimitOptions } from "./body-limit.ts";
export { createRestService, createService, GroupRegistrar, ServiceBuilder } from "./builder.ts";
export type { RestService } from "./builder.ts";
export type {
  DefaultsChain,
  PermissionScope,
  RestChain,
  RestEndpoint,
  RestEndpointHandler,
  RestHandlerResult,
  RouteChain,
  ScopeIdKey,
  ScopeIdsIn,
  SseChain,
} from "./definition.ts";
export { loggerMiddleware, tracerMiddleware } from "./middleware.ts";
export {
  restVersionSelectorMiddleware,
  RestVersionSelector,
  type RestVersionSelection,
  type RestVersionSelectorMiddlewareOptions,
  type RestVersionSelectorOptions,
  type RestVersionSource,
} from "./rest-version-selector.ts";
// Spec generation must come from the same hono-openapi package instance that
// attached the route metadata. Re-export it so hosts cannot accidentally use
// a peer-resolved copy with a different metadata symbol.
export { generateSpecs as generateApiSpecs } from "hono-openapi";
export { normalizeExclusiveBounds } from "./openapi-exclusive-bounds.ts";

import type { Hono } from "hono";
import { handle } from "hono/vercel";

export function routeHandlers(app: Hono) {
  const h = handle(app);
  return { GET: h, POST: h, PUT: h, DELETE: h, PATCH: h } as const;
}
export { createSSEResponse, type SSEHandler, type TypedSSEStream } from "./sse.ts";
export {
  type BaseApp,
  API_VERSION_HEADER,
  type DateVersion,
  type EndpointDef,
  type EndpointConfig,
  type EndpointDocs,
  type EndpointRegistration,
  type EndpointVariables,
  type HttpMethod,
  isDateVersion,
  type MountedRoute,
  type RequestActor,
  type RestServiceConfig,
  type StaticRestVersioning,
  type ServiceConfig,
  type ServiceContext,
  VERSION_LATEST,
  VERSION_PREVIEW,
  type VersionLabel,
  type VersionStatus,
} from "./types.ts";
export { type RegistrationEvent, type ResolvedEndpoint, resolveVersions } from "./versioning.ts";

// ---------------------------------------------------------------------------
// Route security — the route-policy registry, the OpenAPI security projection
// and the REST service builder. The access-policy vocabulary they are keyed on
// is transport-agnostic and lives at `@langwatch/api`.
// ---------------------------------------------------------------------------

export {
  documentedPathOf,
  isHttpMethod,
  type SecurityRequirement,
  securityForCredentialClass,
} from "./security/openapi-security.ts";
export {
  assertEveryRouteDeclared,
  type MountedRouteTable,
  undeclaredRoutes,
} from "./security/route-declaration.ts";
export {
  allRegisteredRoutes,
  getRoutePolicy,
  type RegisteredRoute,
  registerRoutePolicy,
} from "./security/route-registry.ts";
export {
  type ApiErrorEnvelope,
  createRestApiService,
  familyFromBasePath,
  type RestApiService,
  type RestApiServicePorts,
  type RestApiVersionedFamily,
  SecuredApp,
  type SealedRestApp,
  type SecuredVerbs,
  type VersionedAppOptions,
  type VersionedEndpointMeta,
  type VersionedFamilyScope,
} from "./security/rest-api-service.ts";

// The REST kit route families are built from — moved out of `apps/api/src/app-rest`
// so a family in `packages/features/<f>/server` shares one validator, error
// vocabulary, and idempotency contract with an application-mounted family.
// Every BOUND instance (permission catalogue, broadcast transport, audit
// sink) stayed behind, since each needs a database/queue a package may not read.

export {
  type AppRestSecurity,
  type AppRestSecurityPorts,
  createAppRestSecurity,
} from "./app-security.ts";
export type { AppRestOrganizationVariables, AppRestProjectVariables } from "./variables.ts";
export type { MountableRestApp } from "./types.ts";

// Ports a REST family declares and a process binds.
export type { AppRestBroadcast } from "./broadcast.ts";
export type { AppRestRbacVocabulary } from "./rbac-vocabulary.ts";
export type { PlatformUrlBuilder } from "./platform-url.ts";

// The management surface's shared vintage and audit emission.
export { MANAGEMENT_API_VERSION } from "./management-version.ts";
export {
  type AppRestManagementAuditPort,
  emitManagementAudit,
  managementActor,
} from "./management-audit.ts";

// Marking a family as a deprecated alias: the headers every one of its
// responses, refusals included, names its successor with.
export { deprecatedAlias } from "./deprecation.ts";

// A family's own `onError`, layered over the spine's.
export { createCanonicalFamilyErrorHandler } from "./canonical-family-error-handler.ts";
export { createFamilyErrorHandler } from "./family-error-handler.ts";
export { handWrittenDocs } from "./hand-written-docs.ts";
// The OpenAPI schema wrapper a family needs to document a response body of its
// own. Re-exported so a transport file never reaches for hono-openapi itself.
export { resolver } from "hono-openapi";

// The status-carrying error vocabulary the boundary throws.
export {
  BadRequestError,
  ForbiddenError,
  HttpError,
  InternalServerError,
  isFrameworkRefusal,
  NotFoundError,
  UnauthorizedError,
  UnprocessableEntityError,
} from "./http-errors.ts";

// The scope a request arrived on, read off the handler's own context.
export {
  organizationOf,
  projectOf,
  type OrganizationScopedContext,
  type ProjectScopedContext,
  type RestErrorHandler,
} from "./scope-accessors.ts";

// The answer of an any-method route that is not the one to serve this request.
export { declined, type Declined } from "./response.ts";

// The wire shapes: the canonical envelope and the flat legacy one.
export {
  API_ERROR_TYPE_BY_STATUS,
  type ApiErrorBody,
  apiErrorBody,
  apiErrorSchema,
  apiErrorType,
  badRequestSchema,
  coerceToEpoch,
  conflictSchema,
  errorSchema,
  FALLBACK_API_ERROR_TYPE,
  flexibleDateSchema,
  successSchema,
  unauthorizedSchema,
} from "./schemas.ts";

// The documented responses a route spreads into its OpenAPI block.
export {
  baseResponses,
  buildStandardSuccessResponse,
  canonicalBaseResponses,
  canonicalConflictResponses,
  canonicalUnprocessableResponses,
  conflictResponses,
} from "./base-responses.ts";
export type { RouteResponse } from "./response-types.ts";

// `Idempotency-Key`: the header names, the bounds, the reader and the writer.
export {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  type IdempotentExecuted,
  type IdempotentOutcome,
  type IdempotentReplayed,
  type IdempotentRunner,
  idempotencyKeyParameter,
  idempotentJson,
  idempotentReplayHeaders,
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  readIdempotencyKey,
} from "./idempotency.ts";

// `Idempotency-Key`: the receipt ledger the wire half dispatches through.
export {
  HEARTBEAT_INTERVAL_MS,
  IdempotencyConflictError,
  type IdempotencyConflictReason,
  IdempotencyLedger,
  type IdempotencyReceiptCreateInput,
  type IdempotencyReceiptPersistence,
  type IdempotencyReceiptRecord,
  type IdempotencyReceiptUpdateInput,
  type IdempotencyResponseCipher,
  isClaimAbandoned,
  RECEIPT_TTL_MS,
  serializeResponseBody,
  TAKEOVER_AFTER_MS,
  withIdempotency,
  type WithIdempotencyParams,
} from "./idempotency-ledger.ts";

// Shared hardening for the routes that stream stored-object bytes.
export {
  jsonResponse,
  rateLimitedResponse,
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
} from "./media-response.ts";

// The credential a request arrived with, for a second permission question.
export {
  credentialPrincipalOf,
  credentialPrincipalOfToken,
  organizationCredentialPrincipalOf,
  organizationCredentialPrincipalOfToken,
  type RestCredentialPrincipal,
  type RestOrganizationCredentialPrincipal,
  type RestProjectCredentialPrincipal,
} from "./credential-principal.ts";

// Who is behind a personal-workspace key.
export {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  PersonalUsageServiceKeyUnsupportedError,
  resolvePersonalCaller,
} from "./personal-caller.ts";

// The correlation handles every canonical refusal quotes.
export { requestTraceIds } from "./trace-ids.ts";

// The request validator that fails the way the rest of the boundary fails.
export { type FieldViolation, RequestValidationError, validator } from "./validation.ts";
export { createRestRouter, type RestTransportDescriptor } from "./create-rest-router.ts";
