/**
 * The application's REST boundary, owned by the API process.
 *
 * The kit itself no longer lives here. The request validator, the error
 * vocabulary, the response schemas, the idempotency wire contract, the
 * correlation handles, the family error handlers and the port TYPES a family
 * declares are all `@langwatch/api/rest`, because a REST family that lives in
 * `packages/features/<f>/server/src/api/rest` needs exactly the same ones and
 * a package may not import an application.
 *
 * What this barrel owns now is only the re-exports below, which are the
 * legacy families' one import site; a family that has moved imports from
 * `@langwatch/api`, `@langwatch/api/rest` and its own feature package
 * instead. The all-or-nothing enumeration that used to live here
 * (`createAppRestFeatures`, thirty-two product services in one call) is gone:
 * the API process mounts what it composed through
 * `createApiProcessRestFeatures`, one family at a time, and names the rest.
 *
 * The REST service is NOT a module-level singleton. Building one needs
 * authentication that reads API keys, sessions and role bindings out of a
 * database, plus the application's own error taxonomy for the two envelopes;
 * a process supplies those to `createAppRestSecurity` once and passes the
 * result to each feature's mount. That keeps the invariant the service exists
 * for — a route cannot be registered without declaring an access policy, and
 * the policy's enforcement is bound before the route is built — while letting
 * the feature live in a package that has no database of its own.
 */
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
} from "@langwatch/api";

export {
  type ApiErrorBody,
  type ApiErrorEnvelope,
  API_ERROR_TYPE_BY_STATUS,
  allRegisteredRoutes,
  apiErrorBody,
  apiErrorSchema,
  apiErrorType,
  type AppRestBroadcast,
  type AppRestManagementAuditPort,
  type AppRestOrganizationVariables,
  type AppRestProjectVariables,
  type AppRestRbacVocabulary,
  type AppRestSecurity,
  type AppRestSecurityPorts,
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
  createAppRestSecurity,
  createCanonicalFamilyErrorHandler,
  createFamilyErrorHandler,
  documentedPathOf,
  emitManagementAudit,
  errorSchema,
  FALLBACK_API_ERROR_TYPE,
  familyFromBasePath,
  type FieldViolation,
  flexibleDateSchema,
  ForbiddenError,
  getRoutePolicy,
  HttpError,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  type IdempotentHandlerResult,
  type IdempotentOutcome,
  type IdempotentRunner,
  idempotencyKeyParameter,
  idempotentJson,
  idempotentReplayHeaders,
  InternalServerError,
  isHttpMethod,
  jsonResponse,
  managementActor,
  MANAGEMENT_API_VERSION,
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  type MountableRestApp,
  NotFoundError,
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  type PlatformUrlBuilder,
  rateLimitedResponse,
  readIdempotencyKey,
  type RegisteredRoute,
  registerRoutePolicy,
  RequestValidationError,
  requestTraceIds,
  resolvePersonalCaller,
  type RestApiVersionedFamily,
  type RouteResponse,
  safeMediaType,
  sanitizeFilenameSegment,
  SecuredApp,
  type SecuredVerbs,
  type SecurityRequirement,
  securityForCredentialClass,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
  successSchema,
  UnauthorizedError,
  unauthorizedSchema,
  UnprocessableEntityError,
  validator,
  type VersionedEndpointMeta,
} from "@langwatch/api/rest";
