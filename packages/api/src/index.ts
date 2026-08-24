// ---------------------------------------------------------------------------
// @langwatch/api -- Public API
// ---------------------------------------------------------------------------

export { createService, GroupRegistrar, ServiceBuilder } from "./builder.js";
export type {
  DefaultsChain,
  RouteChain,
  RpcChain,
  SseChain,
} from "./definition.js";
export {
  DISCOVER_NAME,
  type DiscoveredOperation,
  type ServiceCatalogue,
} from "./discover.js";
export {
  AuthenticatedActorRequiredError,
  createErrorHandler,
  formatError,
  ProjectInputMismatchError,
} from "./errors.js";
export { loggerMiddleware, tracerMiddleware } from "./middleware.js";
// Spec generation must come from the same hono-openapi package instance that
// attached the route metadata. Re-export it so hosts cannot accidentally use
// a peer-resolved copy with a different metadata symbol.
export { generateSpecs as generateApiSpecs } from "hono-openapi";
export type { RateLimiter, ResponseCache } from "./ports.js";
export { isRpcPath, type RpcName } from "./rpc-name.js";
export type { ApiSchema, ApiSchemaOutput } from "./schema.js";

import type { Hono } from "hono";
import { handle } from "hono/vercel";

export function routeHandlers(app: Hono) {
  const h = handle(app);
  return { GET: h, POST: h, PUT: h, DELETE: h, PATCH: h } as const;
}
export {
  createSSEResponse,
  type SSEHandler,
  type TypedSSEStream,
} from "./sse.js";
export {
  type BaseApp,
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
  type ServiceConfig,
  type ServiceContext,
  VERSION_LATEST,
  VERSION_PREVIEW,
  type VersionLabel,
  type VersionStatus,
} from "./types.js";
export {
  type RegistrationEvent,
  type ResolvedEndpoint,
  resolveVersions,
} from "./versioning.js";
