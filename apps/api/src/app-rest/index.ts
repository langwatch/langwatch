/**
 * The application's REST boundary, owned by the API process.
 *
 * A REST feature in this package imports everything it needs from here: the
 * access-policy vocabulary (`@langwatch/api`) and the route-policy registry
 * (`@langwatch/api/rest`), the request validator and OpenAPI response
 * vocabulary, and the type of the REST service its mount will hand it.
 *
 * That service is NOT a module-level singleton. Building one needs
 * authentication that reads API keys, sessions and role bindings out of a
 * database, plus the application's own error taxonomy for the two envelopes;
 * a process supplies those to {@link createAppRestSecurity} once and passes the
 * result to each feature's mount. That keeps the invariant the service exists
 * for — a route cannot be registered without declaring an access policy, and
 * the policy's enforcement is bound before the route is built — while letting
 * the feature live in a package that has no database of its own.
 */
export {
  type AppRestSecurity,
  type AppRestSecurityPorts,
  createAppRestSecurity,
} from "./app-rest.security";
export type { AppRestOrganizationVariables, AppRestProjectVariables } from "./app-rest.variables";
export {
  type AppRestFeaturePorts,
  type AppRestFeatureServices,
  createAppRestFeatures,
  type MountableRestApp,
  portsUnavailableOffRequestPath,
  servicesUnavailableOffRequestPath,
} from "./app-rest.features";
export { MANAGEMENT_API_VERSION } from "./app-rest.management-version";
export {
  type AppRestManagementAuditPort,
  emitManagementAudit,
  managementActor,
} from "./app-rest.management-audit";
export { createCanonicalFamilyErrorHandler } from "./app-rest.canonical-family-error-handler";
export { createFamilyErrorHandler } from "./app-rest.family-error-handler";
export type { AppRestRbacVocabulary } from "./app-rest.rbac-vocabulary";
export {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  resolvePersonalCaller,
} from "./app-rest.personal-caller";

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
  type ApiErrorEnvelope,
  allRegisteredRoutes,
  documentedPathOf,
  familyFromBasePath,
  getRoutePolicy,
  isHttpMethod,
  type RegisteredRoute,
  registerRoutePolicy,
  type RestApiVersionedFamily,
  SecuredApp,
  type SecuredVerbs,
  type SecurityRequirement,
  securityForCredentialClass,
  type VersionedEndpointMeta,
} from "@langwatch/api/rest";

export {
  baseResponses,
  buildStandardSuccessResponse,
  canonicalBaseResponses,
  canonicalConflictResponses,
  canonicalUnprocessableResponses,
  conflictResponses,
} from "./app-rest.base-responses";
export {
  BadRequestError,
  ForbiddenError,
  HttpError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  UnprocessableEntityError,
} from "./app-rest.http-errors";
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
} from "./app-rest.idempotency";
export type { AppRestBroadcast } from "./app-rest.broadcast";
export {
  jsonResponse,
  rateLimitedResponse,
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
} from "./app-rest.media-response";
export type { PlatformUrlBuilder } from "./app-rest.platform-url";
export type { RouteResponse } from "./app-rest.response-types";
export { requestTraceIds } from "./app-rest.trace-ids";
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
} from "./app-rest.schemas";
export {
  type FieldViolation,
  hiddenValidator,
  RequestValidationError,
  validator,
} from "./app-rest.validation";
export { patchZodOpenapi } from "./app-rest.zod-openapi";
