import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType, z } from "zod";

// ---------------------------------------------------------------------------
// Version primitives
// ---------------------------------------------------------------------------

/** A date-based API version string, e.g. `"2025-03-15"`. Validated at runtime. */
export type DateVersion = string;

export const VERSION_LATEST = "latest" as const;
export const VERSION_PREVIEW = "preview" as const;

const DATE_VERSION_RE = /^20\d{2}-\d{2}-\d{2}$/;

/** Returns true when `value` matches the `YYYY-MM-DD` date-version pattern. */
export function isDateVersion(value: string): value is DateVersion {
  return DATE_VERSION_RE.test(value);
}

// ---------------------------------------------------------------------------
// HTTP method
// ---------------------------------------------------------------------------

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

// ---------------------------------------------------------------------------
// Base app context
// ---------------------------------------------------------------------------

/**
 * The base application context available to every handler.
 *
 * Generic `TProject` lets consumers type `app.project` downstream:
 *
 * ```ts
 * createService<{ project: Project }>({ name: "things" })
 * ```
 */
export interface BaseApp<TProject = unknown> {
  project: TProject;
  _legacy: {
    organization: unknown;
    prisma: unknown;
  };
}

// ---------------------------------------------------------------------------
// Endpoint configuration
// ---------------------------------------------------------------------------

/**
 * Per-endpoint configuration object -- the second argument to
 * `v.get(path, config, handler)`.
 *
 * Merges schema declarations (input, output, params, query) with per-endpoint
 * options (auth, resourceLimit, middleware, etc.).
 */
export interface EndpointConfig<
  TInput extends ZodType = ZodType,
  TOutput extends ZodType = ZodType,
  TParams extends ZodType = ZodType,
  TQuery extends ZodType = ZodType,
> {
  /** JSON body schema. */
  input?: TInput;
  /** Response body schema -- validated before serialization. */
  output?: TOutput;
  /** Path parameter schema. */
  params?: TParams;
  /** Query string schema. */
  query?: TQuery;
  /** OpenAPI description for the endpoint. */
  description?: string;
  /** HTTP status code for successful responses (default: 200). */
  status?: ContentfulStatusCode;

  // -- per-endpoint options --------------------------------------------------

  /**
   * Auth behaviour for this endpoint.
   * - `"default"` -- use the service-level auth middleware (default).
   * - `"none"` -- skip authentication entirely.
   * - A `MiddlewareHandler` -- use a custom auth middleware for this endpoint.
   */
  auth?: "default" | "none" | MiddlewareHandler;
  /** Resource limit type — requires `_legacy.resourceLimitMiddleware` on the service. */
  resourceLimit?: string;
  /** Additional middleware to run for this endpoint (after auth, before handler). */
  middleware?: MiddlewareHandler[];
}

// ---------------------------------------------------------------------------
// Service configuration (top-level)
// ---------------------------------------------------------------------------

/**
 * Top-level configuration for `createService()`.
 */
export interface ServiceConfig {
  /** Service name, used in the default base path (`/api/${name}`). */
  name: string;
  /** Override the default base path. */
  basePath?: string;
  /** Default auth middleware applied to every endpoint (unless overridden). */
  auth?: MiddlewareHandler;
  /** Disable the built-in tracer middleware. Set to `false` to opt out. */
  tracer?: false;
  /** Disable the built-in logger middleware. Set to `false` to opt out. */
  logger?: false;
  /** Additional global middleware applied to every request. */
  middleware?: MiddlewareHandler[];
  /** Custom error handler. If omitted the framework default is used. */
  onError?: (err: Error, c: Context) => Response | Promise<Response>;
  /** Middleware that will be removed once services are fully migrated. */
  _legacy?: {
    /** Organization-resolution middleware. */
    organizationMiddleware?: MiddlewareHandler;
    /** Factory for resource-limit middleware, called per-endpoint. */
    resourceLimitMiddleware?: (limitType: string) => MiddlewareHandler;
  };
}

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

/** Extract inferred input type from config, defaulting to undefined. */
type InferInput<TConfig> = TConfig extends { input: infer I extends ZodType } ? z.infer<I> : undefined;

/** Extract inferred params type from config, defaulting to undefined. */
type InferParams<TConfig> = TConfig extends { params: infer P extends ZodType } ? z.infer<P> : undefined;

/** Extract inferred query type from config, defaulting to undefined. */
type InferQuery<TConfig> = TConfig extends { query: infer Q extends ZodType } ? z.infer<Q> : undefined;

/** Extract inferred output type from config. */
type InferOutput<TConfig> = TConfig extends { output: infer O extends ZodType } ? z.infer<O> : never;

/**
 * The handler function signature.
 *
 * When `output` is defined the handler returns raw data (framework validates
 * and serializes). When `output` is *not* defined the handler returns a raw
 * Hono `Response`.
 */
export type Handler<TApp, TConfig> = (
  c: Context,
  args: {
    input: InferInput<TConfig>;
    params: InferParams<TConfig>;
    query: InferQuery<TConfig>;
    app: TApp;
  },
) => TConfig extends { output: ZodType }
  ? InferOutput<TConfig> | Promise<InferOutput<TConfig>>
  : Response | Promise<Response>;

// ---------------------------------------------------------------------------
// Internal endpoint registration record
// ---------------------------------------------------------------------------

/** @internal Stored by the version builder when registering an endpoint. */
export interface EndpointRegistration {
  method: HttpMethod | "sse";
  path: string;
  config: EndpointConfig;
  handler: (...args: unknown[]) => unknown;
  withdrawn?: boolean;
}

// ---------------------------------------------------------------------------
// Version status (set as response header)
// ---------------------------------------------------------------------------

export type VersionStatus = "stable" | "latest" | "preview" | "unversioned";

/** HTTP status text lookup for error responses. */
export function httpStatusText(status: ContentfulStatusCode): string {
  const map: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    410: "Gone",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return map[status] ?? "Error";
}
