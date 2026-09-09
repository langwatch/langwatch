// @langwatch/api/rest -- the Hono transport: one complete declaration per route
// (`defineRestRouter`), the runtime a process mounts it on, and the request,
// credential, response, document and security vocabularies a family names. The
// error vocabulary, the access-policy vocabulary, the capability ports and the
// schema boundary live at `@langwatch/api` and are NOT re-exported from here: a
// consumer imports each from the entry point that owns it.

// The addressing half: the version vocabulary a family serves at, the
// `/api/v1` alias every `/api` family answers under, and the static generation
// a hand-mounted transport negotiates.
export {
  API_VERSION_HEADER,
  assertVersionLabel,
  canonicalV1Path,
  isDateVersion,
  MANAGEMENT_API_VERSION,
  RestVersionSelector,
  restVersionSelectorMiddleware,
  undescribedStack,
  V1_PREFIX,
  VERSION_LATEST,
  VERSION_PREVIEW,
  type DateVersion,
  type HttpMethod,
  type MountableRestApp,
  type RestAddressing,
  type RestAddressingOptions,
  type RestVersionSelection,
  type RestVersionSelectorMiddlewareOptions,
  type RestVersionSelectorOptions,
  type RestVersionSource,
  type VersionLabel,
  type VersionStatus,
} from "./addressing.ts";

// The declaration half: one complete declaration per route, and the vocabulary
// a route states its sources, its answers and its door with.
export {
  defineRestRouter,
  projectRestFacts,
  type FeatureApiWitness,
  type RestDeprecation,
  type RestDoorCredential,
  type RestMethodName,
  type RestPermissionTarget,
  type RestRouteAnswers,
  type RestTransportDeclaration,
  type RestTransportRoute,
} from "./declaration.ts";

// The runtime half: the ports a process fills, and the mount that puts a
// family's declaration behind the one execution path.
export {
  createRestRuntime,
  type RestCaller,
  type RestDeprecationLogPort,
  type RestMountOptions,
  type RestRuntime,
  type RestRuntimePorts,
} from "./runtime.ts";

// The request half: the validator that fails the way the boundary fails, the
// wire-size cap nine ingestion families apply, the tracer and request logger,
// the declared middleware facts, SSE, and `Idempotency-Key` with its ledger.
// The `Idempotency-Key` half: the header and its bounds, the declared
// parameter and replay marker, and the receipt ledger a create replays from.
export {
  HEARTBEAT_INTERVAL_MS,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyConflictError,
  IdempotencyLedger,
  idempotencyKeyParameter,
  IDEMPOTENT_REPLAY_HEADER,
  idempotentJson,
  idempotentReplayHeaders,
  isClaimAbandoned,
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  readIdempotencyKey,
  RECEIPT_TTL_MS,
  serializeResponseBody,
  TAKEOVER_AFTER_MS,
  withIdempotency,
  type IdempotencyConflictReason,
  type IdempotencyReceiptCreateInput,
  type IdempotencyReceiptPersistence,
  type IdempotencyReceiptRecord,
  type IdempotencyReceiptUpdateInput,
  type IdempotencyResponseCipher,
  type IdempotentExecuted,
  type IdempotentOutcome,
  type IdempotentReplayed,
  type IdempotentRunner,
  type RestIdempotency,
  type WithIdempotencyParams,
} from "./idempotency.ts";

export {
  bindRestHeader,
  bindRestMiddleware,
  bodyLimit,
  createSSEResponse,
  defineRestMiddleware,
  loggerMiddleware,
  multipartMiddleware,
  RequestValidationError,
  requestValidationErrorFrom,
  restCacheKey,
  restRateLimitKey,
  tracerMiddleware,
  validator,
  type AppRestBroadcast,
  type BodyLimitOptions,
  type FieldViolation,
  type RestCachePolicy,
  type RestMultipart,
  type RestMultipartDeclared,
  type RestMultipartFile,
  type RestMultipartFiles,
  type RestRateLimitPolicy,
  type RestRawAnswer,
  type RestRawAnswerDeclared,
  type RestRawBody,
  type RestRawBodyDeclared,
  type RestRawBodyForm,
  type RestRawBodyOut,
  type RestRawResponse,
  type RestRawResult,
  type RestTransportMiddleware,
  type RestTransportMiddlewareBinding,
  type SSEHandler,
  type TypedSSEStream,
} from "./request.ts";

// The credential half: the project and credential a door resolves, the
// principal a second permission question is asked with, the scope a handler
// reads back, and who is behind a personal-workspace key.
export {
  credentialPrincipalOf,
  credentialPrincipalOfToken,
  organizationCredentialPrincipalOf,
  organizationCredentialPrincipalOfToken,
  organizationOf,
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  PersonalUsageServiceKeyUnsupportedError,
  projectOf,
  resolvePersonalCaller,
  type AppRestOrganizationVariables,
  type AppRestProjectVariables,
  type OrganizationScopedContext,
  type ProjectScopedContext,
  type RestCredentialPrincipal,
  type RestErrorHandler,
  type RestOrganizationCredentialPrincipal,
  type RestProjectCredentialPrincipal,
  type RestProjectIdentity,
  type RestResolvedInternalCredential,
  type RestResolvedOrganizationCredential,
  type RestResolvedProjectCredential,
} from "./credential.ts";

// The response half: the context keys, the handler context, the status-carrying
// error vocabulary, the two wire envelopes and their documented responses, the
// stored-object hardening, the trace handles and the family error handlers.
export {
  API_ERROR_TYPE_BY_STATUS,
  apiErrorBody,
  apiErrorSchema,
  apiErrorType,
  BadRequestError,
  badRequestSchema,
  baseResponses,
  buildStandardSuccessResponse,
  canonicalBaseResponses,
  canonicalConflictResponses,
  canonicalUnprocessableResponses,
  coerceToEpoch,
  conflictResponses,
  conflictSchema,
  createCanonicalFamilyErrorHandler,
  createFamilyErrorHandler,
  DECLARED_ANSWER,
  declined,
  ENDPOINT_INPUT,
  ENDPOINT_ROUTE,
  errorSchema,
  FALLBACK_API_ERROR_TYPE,
  flexibleDateSchema,
  ForbiddenError,
  HttpError,
  InternalServerError,
  isDeclined,
  isFrameworkRefusal,
  jsonResponse,
  NotFoundError,
  rateLimitedResponse,
  REQUEST_FAMILY,
  REQUEST_LOG_CLAIM,
  requestTraceIds,
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
  successSchema,
  unauthorizedSchema,
  UnauthorizedError,
  UnprocessableEntityError,
  type ApiErrorBody,
  type Declined,
  type EndpointDocs,
  type EndpointVariables,
  type RequestActor,
  type RouteResponse,
  type ServiceContext,
} from "./response.ts";

// The document half. Spec generation must come from the same hono-openapi
// package instance that attached the route metadata, so the generator and the
// schema wrapper are re-exported here: a transport file never reaches for
// hono-openapi itself, and a peer-resolved copy has a different metadata symbol.
export {
  deprecatedAlias,
  deprecationNotice,
  documentedPathOf,
  documentedResponses,
  documentRoute,
  handWrittenDocs,
  isHttpMethod,
  normalizeExclusiveBounds,
  operationIdOf,
  restRouteDocumentation,
  securityForCredentialClass,
  type PlatformUrlBuilder,
  type RestTransportDocs,
  type SecurityRequirement,
} from "./openapi.ts";
export { generateSpecs as generateApiSpecs, resolver } from "hono-openapi";

// The security half: the ports one process fills for its own doors, the
// cross-check that every mounted route declared a policy, the refusal
// fingerprint, the shared-secret comparison and the management audit.
export {
  allRegisteredRoutes,
  assertEveryRouteDeclared,
  collectAuthDiagnostics,
  emitManagementAudit,
  familyFromBasePath,
  getRoutePolicy,
  isInternalSecretValid,
  managementActor,
  registerRoutePolicy,
  undeclaredRoutes,
  type ApiErrorEnvelope,
  type AppRestManagementAuditPort,
  type AppRestRbacVocabulary,
  type AppRestSecurityPorts,
  type AuthDiagnostics,
  type MountedRouteTable,
  type RegisteredRoute,
  type RestApiServicePorts,
} from "./security.ts";

import type { Hono } from "hono";
import { handle } from "hono/vercel";

/** Converts a built app into per-file route handlers, for legacy Next-style hosts. */
export function routeHandlers(app: Hono) {
  const h = handle(app);

  return { GET: h, POST: h, PUT: h, DELETE: h, PATCH: h } as const;
}
