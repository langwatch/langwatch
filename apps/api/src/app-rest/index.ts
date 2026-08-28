/**
 * The application's REST boundary, owned by the API process.
 *
 * A REST feature in this package imports everything it needs from here: the
 * access-policy vocabulary and route-policy registry (which live in
 * `@langwatch/api`), the request validator and OpenAPI response vocabulary,
 * and the type of the security spine its mount will hand it.
 *
 * The spine itself is NOT a module-level singleton. Building one needs
 * authentication that reads API keys, sessions and role bindings out of a
 * database, plus the application's own error taxonomy for the two envelopes;
 * a process supplies those to {@link createAppRestSecurity} once and passes the
 * result to each feature's mount. That keeps the invariant the builder exists
 * for — a route cannot be registered without declaring an access policy, and
 * the policy's enforcement is bound before the route is built — while letting
 * the feature live in a package that has no database of its own.
 */
export {
  type AppRestSecurity,
  type AppRestSecurityPorts,
  createAppRestSecurity,
} from "./app-rest.security";
export type {
  AppRestOrganizationVariables,
  AppRestProjectVariables,
} from "./app-rest.variables";
export {
  type AppRestFeatureServices,
  createAppRestFeatures,
  type MountableRestApp,
  servicesUnavailableOffRequestPath,
} from "./app-rest.features";

export {
  type AccessPolicy,
  type ApiErrorEnvelope,
  allRegisteredRoutes,
  anyAuthenticated,
  apiKeyPermission,
  type CredentialClass,
  credentialClassFor,
  describeAccessPolicy,
  documentedPathOf,
  familyFromBasePath,
  getRoutePolicy,
  type HandlerCredential,
  handlerManagedAuth,
  internalSecret,
  isApiKeyReachable,
  isHttpMethod,
  policyPermissions,
  publicEndpoint,
  type RegisteredRoute,
  registerRoutePolicy,
  requires,
  requiresOnProject,
  SecuredApp,
  type SecuredVerbs,
  type SecurityRequirement,
  securityForCredentialClass,
} from "@langwatch/api";

export {
  baseResponses,
  canonicalBaseResponses,
  canonicalConflictResponses,
  canonicalUnprocessableResponses,
  conflictResponses,
} from "./app-rest.base-responses";
export type { RouteResponse } from "./app-rest.response-types";
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
