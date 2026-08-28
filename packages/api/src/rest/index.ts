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
export type { DefaultsChain, RestChain, RouteChain, SseChain } from "./definition.js";
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
