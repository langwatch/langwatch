// ---------------------------------------------------------------------------
// @langwatch/api -- Public API
// ---------------------------------------------------------------------------

export { createService, ServiceBuilder, VersionBuilder } from "./builder.js";
export { createErrorHandler, formatError } from "./errors.js";
export { tracerMiddleware, loggerMiddleware } from "./middleware.js";
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
  VERSION_LATEST,
  VERSION_PREVIEW,
  isDateVersion,
  httpStatusText,
  type BaseApp,
  type DateVersion,
  type EndpointConfig,
  type EndpointRegistration,
  type Handler,
  type HttpMethod,
  type ServiceConfig,
  type VersionStatus,
} from "./types.js";
export {
  resolveVersions,
  resolveRequestVersion,
  type ResolvedEndpoint,
  type ResolvedVersion,
  type VersionDefinition,
} from "./versioning.js";
