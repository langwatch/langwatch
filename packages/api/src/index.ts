// ---------------------------------------------------------------------------
// @langwatch/api -- Public API
// ---------------------------------------------------------------------------

export { createService, ServiceBuilder, VersionBuilder } from "./builder.js";
export type { RpcConfig, RpcPath } from "./version-builder.js";
export { createErrorHandler, formatError } from "./errors.js";
export { loggerMiddleware, tracerMiddleware } from "./middleware.js";

import type { Hono } from "hono";
import { handle } from "hono/vercel";

export function routeHandlers(app: Hono) {
  const h = handle(app);
  return { GET: h, POST: h, PUT: h, DELETE: h, PATCH: h } as const;
}
export {
  createSSEResponse,
  type SSEConfig,
  type SSEHandler,
  type TypedSSEStream,
} from "./sse.js";
export {
  type BaseApp,
  type DateVersion,
  type EndpointConfig,
  type EndpointDocs,
  type EndpointRegistration,
  type Handler,
  type HttpMethod,
  httpStatusText,
  isDateVersion,
  type MountedRoute,
  type ServiceConfig,
  VERSION_LATEST,
  VERSION_PREVIEW,
  type VersionStatus,
} from "./types.js";
export {
  type ResolvedEndpoint,
  type ResolvedVersion,
  resolveRequestVersion,
  resolveVersions,
  type VersionDefinition,
} from "./versioning.js";
