// ---------------------------------------------------------------------------
// @langwatch/api/rest -- the Hono service framework
//
// Versioned namespaces, the definition chain, the endpoint pipeline, SSE, and
// the route security spine every LangWatch REST family mounts on.
//
// The error vocabulary, the access-policy vocabulary, the capability ports and
// the schema boundary live at `@langwatch/api` and are NOT re-exported from
// here: a consumer imports each from the entry point that owns it.
// ---------------------------------------------------------------------------

export { createRestService, createService, GroupRegistrar, ServiceBuilder } from "./builder.js";
export type { RestService } from "./builder.js";
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
} from "./definition.js";
export { loggerMiddleware, tracerMiddleware } from "./middleware.js";
export {
  restVersionSelectorMiddleware,
  RestVersionSelector,
  type RestVersionSelection,
  type RestVersionSelectorMiddlewareOptions,
  type RestVersionSelectorOptions,
  type RestVersionSource,
} from "./rest-version-selector.js";
// Spec generation must come from the same hono-openapi package instance that
// attached the route metadata. Re-export it so hosts cannot accidentally use
// a peer-resolved copy with a different metadata symbol.
export { generateSpecs as generateApiSpecs } from "hono-openapi";

import type { Hono } from "hono";
import { handle } from "hono/vercel";

export function routeHandlers(app: Hono) {
  const h = handle(app);
  return { GET: h, POST: h, PUT: h, DELETE: h, PATCH: h } as const;
}
export { createSSEResponse, type SSEHandler, type TypedSSEStream } from "./sse.js";
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
} from "./types.js";
export { type RegistrationEvent, type ResolvedEndpoint, resolveVersions } from "./versioning.js";

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
} from "./security/openapi-security.js";
export {
  allRegisteredRoutes,
  getRoutePolicy,
  type RegisteredRoute,
  registerRoutePolicy,
} from "./security/route-registry.js";
export {
  type ApiErrorEnvelope,
  createRestApiService,
  familyFromBasePath,
  type RestApiService,
  type RestApiServicePorts,
  type RestApiVersionedFamily,
  SecuredApp,
  type SecuredVerbs,
  type VersionedEndpointMeta,
} from "./security/rest-api-service.js";

// ---------------------------------------------------------------------------
// The REST kit an application's route families are built from.
//
// Everything here was previously `apps/api/src/app-rest`, which a package may
// not import: a REST family that lives in `packages/features/<f>/server` needs
// the same request validator, error vocabulary, response schemas, idempotency
// wire contract and correlation handles as one still mounted from an
// application, and two definitions would let one surface's 422 become the
// other's 500 without anything reporting it.
//
// What deliberately did NOT come with it is every BOUND instance: the concrete
// permission catalogue behind `AppRestRbacVocabulary`, the broadcast transport
// behind `AppRestBroadcast`, the function that reads a deployment's origin to
// build a `PlatformUrlBuilder`, the idempotency ledger behind
// `IdempotentRunner`, and the audit sink behind `AppRestManagementAuditPort`.
// Each of those needs a database, a queue or a validated environment, and a
// package may read none of the three. The port type is here; the process that
// owns the substrate supplies the value.
// ---------------------------------------------------------------------------

export {
  type AppRestSecurity,
  type AppRestSecurityPorts,
  createAppRestSecurity,
} from "./app-security.js";
export type { AppRestOrganizationVariables, AppRestProjectVariables } from "./variables.js";
export type { MountableRestApp } from "./types.js";

// Ports a REST family declares and a process binds.
export type { AppRestBroadcast } from "./broadcast.js";
export type { AppRestRbacVocabulary } from "./rbac-vocabulary.js";
export type { PlatformUrlBuilder } from "./platform-url.js";

// The management surface's shared vintage and audit emission.
export { MANAGEMENT_API_VERSION } from "./management-version.js";
export {
  type AppRestManagementAuditPort,
  emitManagementAudit,
  managementActor,
} from "./management-audit.js";

// A family's own `onError`, layered over the spine's.
export { createCanonicalFamilyErrorHandler } from "./canonical-family-error-handler.js";
export { createFamilyErrorHandler } from "./family-error-handler.js";

// The status-carrying error vocabulary the boundary throws.
export {
  BadRequestError,
  ForbiddenError,
  HttpError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  UnprocessableEntityError,
} from "./http-errors.js";

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
} from "./schemas.js";

// The documented responses a route spreads into its OpenAPI block.
export {
  baseResponses,
  buildStandardSuccessResponse,
  canonicalBaseResponses,
  canonicalConflictResponses,
  canonicalUnprocessableResponses,
  conflictResponses,
} from "./base-responses.js";
export type { RouteResponse } from "./response-types.js";

// `Idempotency-Key`: the header names, the bounds, the reader and the writer.
export {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  type IdempotentHandlerResult,
  type IdempotentOutcome,
  type IdempotentRunner,
  idempotencyKeyParameter,
  idempotentJson,
  idempotentReplayHeaders,
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  readIdempotencyKey,
} from "./idempotency.js";

// Shared hardening for the routes that stream stored-object bytes.
export {
  jsonResponse,
  rateLimitedResponse,
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
} from "./media-response.js";

// Who is behind a personal-workspace key.
export {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  resolvePersonalCaller,
} from "./personal-caller.js";

// The correlation handles every canonical refusal quotes.
export { requestTraceIds } from "./trace-ids.js";

// The request validator that fails the way the rest of the boundary fails.
export { type FieldViolation, RequestValidationError, validator } from "./validation.js";
