import type { AccessDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DescribeRouteOptions } from "hono-openapi";
import type { RestVersionSelector } from "./rest-version-selector.js";
import type { ApiSchema } from "./schema.js";

import type { RateLimiter, ResponseCache } from "./ports.js";

// ---------------------------------------------------------------------------
// Version primitives
// ---------------------------------------------------------------------------

/** A date-based API version string, e.g. `"2025-03-15"`. Validated at runtime. */
export type DateVersion = string;

export const VERSION_LATEST = "latest" as const;
export const VERSION_PREVIEW = "preview" as const;
export const API_VERSION_HEADER = "X-API-Version" as const;

/**
 * The version argument of a registration: a real calendar date, or `"preview"`
 * for an endpoint that lives only in the preview namespace. `"latest"` is
 * derived, never registered.
 */
export type VersionLabel = DateVersion | typeof VERSION_PREVIEW;

const DATE_VERSION_RE = /^20\d{2}-\d{2}-\d{2}$/;

/** Returns true when `value` is a real calendar date in `YYYY-MM-DD` form. */
export function isDateVersion(value: string): value is DateVersion {
  if (!DATE_VERSION_RE.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}

/** Asserts the version argument of a registration call. */
export function assertVersionLabel(version: string): void {
  if (version === VERSION_PREVIEW) return;
  if (version === VERSION_LATEST) {
    throw new Error(
      `API version "latest" is derived from the dated registrations and ` +
        `cannot be registered; name a real date in YYYY-MM-DD form`,
    );
  }
  if (!isDateVersion(version)) {
    throw new RangeError(
      `Invalid API version "${version}"; expected a real date in YYYY-MM-DD form`,
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP method
// ---------------------------------------------------------------------------

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

/**
 * Context key holding the endpoint a request matched, as `METHOD /path`.
 *
 * The REGISTERED path, not the URL that arrived: `GET /things/:id` rather than
 * `GET /things/th_01J9Z...`. That is the difference between a field you can
 * group by and one with a distinct value per request — the request log already
 * carries the concrete `url`, and what it lacked was the endpoint identity to
 * aggregate on.
 *
 * Set by the version-context middleware, which is first in every endpoint's
 * stack, so it is present for anything downstream of routing: the request log,
 * and the output-validation failure in `response.ts`, which could otherwise say
 * only that *an* endpoint returned the wrong shape.
 */
export const ENDPOINT_ROUTE = "endpointRoute" as const;

/** Context key holding the complete validated input passed to a regular handler. */
export const ENDPOINT_INPUT = "endpointInput" as const;

// ---------------------------------------------------------------------------
// Base app context (provider factories)
// ---------------------------------------------------------------------------

/**
 * The base request context handed to `.provide()` factories.
 *
 * Generic `TProject` lets consumers type `base.project` downstream:
 *
 * ```ts
 * createService<Project>({ name: "things" })
 * ```
 *
 * Provided services themselves reach handlers as typed context variables
 * (`c.get("things")`), not through this object.
 */
export interface BaseApp<TProject = unknown> {
  project: TProject;
  _legacy: {
    organization: unknown;
    prisma: unknown;
  };
}

// ---------------------------------------------------------------------------
// Endpoint documentation (withDocs)
// ---------------------------------------------------------------------------

/**
 * OpenAPI documentation for an endpoint, declared via `.withDocs(...)`.
 *
 * Every dated mount of a documented endpoint — plus `latest` — reaches the
 * published document; `preview` mounts serve traffic but are never documented.
 * These options shape each documented operation.
 */
export interface EndpointDocs {
  /** Short summary shown next to the operation in the reference. */
  summary?: string;
  /** Long-form description of the operation. */
  description?: string;
  /** Tags used to group the operation in the reference. */
  tags?: string[];
  /**
   * Explicit operation id for the `latest` mount. Set it on every documented
   * endpoint: generated ids leak URL shapes into SDK function names. Dated
   * mounts append their version so every operation in the document is unique.
   */
  operationId?: string;
  /** Exclude the endpoint from the OpenAPI document entirely. */
  hide?: boolean;
  /** Security requirements for the operation. */
  security?: DescribeRouteOptions["security"];
  /**
   * Additional documented responses, merged over the generated success
   * response (same-status keys win).
   */
  responses?: DescribeRouteOptions["responses"];
}

// ---------------------------------------------------------------------------
// Endpoint definition (what the definition chain produces)
// ---------------------------------------------------------------------------

/**
 * The resolved definition of one endpoint, produced by merging the service
 * defaults, the group defaults and the endpoint's own declaration chain
 * (service < group < endpoint; middleware concatenates in that order).
 *
 * This is what travels on `MountedRoute.config`: opt-outs are already resolved,
 * so `rateLimit` / `cache` appear only when they actually apply.
 */
export interface EndpointDef {
  /** JSON body schema. */
  input?: ApiSchema;
  /** Response body schema -- validated before serialization. */
  output?: ApiSchema;
  /** HTTP status code for successful responses (default: 200, or 204 with no body). */
  status?: ContentfulStatusCode;
  /** Path parameter schema (registerRoute only). */
  params?: ApiSchema;
  /** Query string schema (registerRoute and registerSse only). */
  query?: ApiSchema;
  /** SSE event payloads, event name to schema (registerSse only). */
  events?: Record<string, ApiSchema>;
  /** OpenAPI documentation. */
  docs?: EndpointDocs;
  /**
   * Auth behaviour for this endpoint.
   * - `"default"` -- use the service-level auth middleware (default).
   * - `"none"` -- skip authentication entirely.
   * - A `MiddlewareHandler` -- use a custom auth middleware for this endpoint.
   */
  auth?: "default" | "none" | MiddlewareHandler;
  /** Permission enforced by the framework after authentication. */
  permission?: AuthzPermission;
  /** Written reason this endpoint deliberately has no permission check. */
  noPermission?: { reason: string };
  /** Resource limit type — requires `_legacy.resourceLimitMiddleware` on the service. */
  resourceLimit?: string;
  /** Endpoint middleware: service-level first, then group, then endpoint. */
  middleware?: MiddlewareHandler[];
  /**
   * Opaque per-endpoint metadata. The framework never reads it; it travels on
   * `MountedRoute.config` so `onRouteMounted` consumers (route policy
   * registries, gates) can act on it. Nothing in it is documentation.
   */
  meta?: unknown;
  /** Rate limiting applies; requires the `rateLimiter` port on the service. */
  rateLimit?: true;
  /** Written reason this public REST endpoint deliberately has no rate limit. */
  rateLimitOptOutReason?: string;
  /** Written reason this public REST endpoint deliberately has no resource limit. */
  resourceLimitOptOutReason?: string;
  /** Response caching applies; requires the `cache` port and a declared `output`. */
  cache?: { tag: string; ttlSeconds: number };
  /** Deprecation notice; the endpoint still answers, and warns. */
  deprecated?: string;
}

/**
 * Author-facing endpoint configuration. Unlike the merged internal shape, an
 * endpoint must choose exactly one access declaration at compile time.
 */
export type EndpointConfig = Omit<EndpointDef, "permission" | "noPermission"> & AccessDeclaration;

/**
 * The definition shape the chain builder accumulates before precedence is
 * resolved: identical to {@link EndpointDef}, except the two capabilities with
 * explicit opt-outs still carry their `false` markers.
 *
 * @internal
 */
export interface RawEndpointDef extends Omit<EndpointDef, "rateLimit" | "cache" | "resourceLimit"> {
  rateLimit?: boolean;
  cache?: { tag: string; ttlSeconds: number } | false;
  resourceLimit?: string | false;
  rateLimitOptOutReason?: string;
  resourceLimitOptOutReason?: string;
}

// ---------------------------------------------------------------------------
// Endpoint handler context
// ---------------------------------------------------------------------------

/**
 * The context variables every handler can read. `.provide()` services widen
 * this map through the service builder's type, so `c.get("things")` is typed.
 *
 * `query` remains a context value for SSE because the handler's second
 * argument is the stream. Regular RPC and REST handlers receive their input
 * as the second argument instead.
 */
export type EndpointVariables = {
  // biome-ignore lint/suspicious/noExplicitAny: validated at runtime by the declared SSE query schema; inference from the trailing define callback is not expressible in TypeScript.
  query?: any;
};

/** The Hono context a service handler receives, with typed variables. */
export type ServiceContext<
  TVariables extends Record<string, unknown> = EndpointVariables,
  TApp = unknown,
> = Context<{ Variables: TVariables }> & {
  readonly app: TApp;
  actor(): RequestActor;
  authorize(permission: AuthzPermission): Promise<void>;
};

/** Authenticated principal exposed directly to service handlers. */
export interface RequestActor {
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Route-mounting report
// ---------------------------------------------------------------------------

/**
 * One route registration on the built Hono app, reported to
 * `ServiceConfig.onRouteMounted`.
 *
 * `path` is absolute (base path included) and byte-identical to what the
 * app's Hono route table (`app.routes[i].path`) reports for the same
 * registration, so consumers can key route policies on it directly.
 */
export interface MountedRoute {
  /** Mounted HTTP method; SSE endpoints report `"get"`, guards `"all"`. */
  method: HttpMethod | "all";
  /** Absolute route path, including the service base path. */
  path: string;
  /**
   * The mounted version namespace or static generation (`"2025-03-15"`,
   * `"latest"`, `"preview"`, or `"v1"`), or `null` for namespace guards.
   */
  version: string | null;
  /** Version status header value this mount responds with, or `null` for the guards. */
  status: VersionStatus | null;
  /** True when this mount answers 410 Gone for a withdrawn endpoint. */
  withdrawn: boolean;
  /**
   * True for the catch-alls that 404 unknown version namespaces (and the bare
   * paths that no longer alias anything). They are real routes in the Hono
   * route table and MUST be covered by any route policy registry built from
   * this callback.
   */
  isNamespaceGuard?: boolean;
  /**
   * True for the service's own `rpc.discover` catalogue mount: meta by
   * construction, never documented, and carrying no endpoint config. Like the
   * guards, it is a real route in the Hono route table and MUST be covered by
   * any route policy registry built from this callback.
   */
  isDiscoverEndpoint?: boolean;
  /** True for the public REST mount whose date version is optional in the URL. */
  isOptionalVersionRoute?: boolean;
  /**
   * The resolved endpoint definition behind this mount. Withdrawn mounts carry
   * the inherited definition (including `meta`); namespace guards and discover
   * mounts carry `null`.
   */
  config: EndpointDef | null;
}

// ---------------------------------------------------------------------------
// Service configuration (top-level)
// ---------------------------------------------------------------------------

/**
 * Top-level configuration for `createService()`.
 */
export interface ServiceConfig<TApp = unknown> {
  /** Service name, used in the default base path (`/api/${name}`). */
  name: string;
  /** Override the default base path. */
  basePath?: string;
  /** Default auth middleware applied to every endpoint (unless overridden). */
  auth?: MiddlewareHandler;
  /** Builds the enforcement middleware for an endpoint's declared permission. */
  permissionEnforcer?: (permission: AuthzPermission) => MiddlewareHandler;
  /** Disable the built-in tracer middleware. Set to `false` to opt out. */
  tracer?: false;
  /** Disable the built-in logger middleware. Set to `false` to opt out. */
  logger?: false;
  /** Additional global middleware applied to every request. */
  middleware?: MiddlewareHandler[];
  /**
   * Resolves the process-composed application for a request. The framework
   * exposes it directly as `context.app`; feature handlers never resolve or
   * construct services per request.
   */
  app?: (context: Context) => TApp;
  /** Resolves the authenticated actor when a handler calls `context.actor()`. */
  actor?: (context: Context) => RequestActor;
  /**
   * Authorizes an input-dependent permission when a handler calls
   * `context.authorize(permission)`. Static endpoint permissions still belong
   * on `.withPermission(...)`; this seam is for a permission selected from
   * validated request data.
   */
  authorize?: (context: Context, permission: AuthzPermission) => Promise<void>;
  /** @deprecated RPC compatibility check; modern REST uses validated input before authorization. */
  projectIdInput?: true;
  /**
   * Rate limiter port backing `.withRateLimit()`. Declaring the capability
   * without the port fails the build. See `ports.ts`.
   */
  rateLimiter?: RateLimiter;
  /**
   * Response cache port backing `.withCache(...)`. Declaring the capability
   * without the port fails the build. See `ports.ts`.
   */
  cache?: ResponseCache;
  /**
   * Where the full OpenAPI document lives (e.g. `/.well-known/openapi`). The
   * service's `rpc.discover` catalogue points back at it; without it the
   * catalogue omits the pointer.
   */
  openapiUrl?: string;
  /** Custom error handler. If omitted the framework default is used. */
  onError?: (err: Error, c: Context) => Response | Promise<Response>;
  /**
   * Called synchronously during `build()` for every route mounted on the app:
   * each dated version, `latest`, `preview`, withdrawn (410) endpoints, and
   * the namespace guards. Lets the host register route policies without
   * re-deriving the route table.
   */
  onRouteMounted?: (route: MountedRoute) => void;
  /** @internal Enables the additive `/api/v1/{service}` REST surface. */
  publicRest?: {
    versionHeader: string;
    maxInputBytes: number;
    /** Mount direct paths only, without the date-contract namespaces. */
    staticVersioning?: StaticRestVersioning;
    /** OpenAPI security derived from the REST service's authentication configuration. */
    security?: DescribeRouteOptions["security"];
  };
  /** Middleware that will be removed once services are fully migrated. */
  _legacy?: {
    /** Organization-resolution middleware. */
    organizationMiddleware?: MiddlewareHandler;
    /** Factory for resource-limit middleware, called per-endpoint. */
    resourceLimitMiddleware?: (limitType: string) => MiddlewareHandler;
  };
}

/**
 * Configuration for the public REST surface. It defaults to `/api/v1/{name}`;
 * date versions are negotiated by URL or `X-API-Version` within that surface.
 */
export type RestServiceConfig<TApp = unknown> = Omit<
  ServiceConfig<TApp>,
  "onError" | "publicRest"
> & {
  maxInputBytes: number;
  /**
   * Selects a static API generation at the process mount. Omit pathVersion for
   * an unversioned alias, which defaults to the selector's latest generation.
   */
  staticVersioning?: StaticRestVersioning;
  /**
   * The OpenAPI credential declaration for this REST service. It is required
   * when the service has authentication and is applied to every authenticated
   * endpoint, so route documentation cannot drift from enforcement.
   */
  openapiSecurity?: DescribeRouteOptions["security"];
};

/** Static API-generation routing, independent from date-contract routing. */
export type StaticRestVersioning = Readonly<{
  selector: RestVersionSelector;
  pathVersion?: string;
}>;

// ---------------------------------------------------------------------------
// Internal endpoint registration record
// ---------------------------------------------------------------------------

/** @internal Stored by the service builder when registering an endpoint. */
export interface EndpointRegistration {
  kind: "rpc" | "rest" | "public-rest" | "sse";
  method: HttpMethod | "sse";
  /** URL path fragment: `/${name}` for RPC and SSE, the path as-is for REST. */
  path: string;
  config: EndpointDef;
  handler: (...args: unknown[]) => unknown;
  withdrawn?: boolean;
}

// ---------------------------------------------------------------------------
// Version status (set as response header)
// ---------------------------------------------------------------------------

export type VersionStatus = "stable" | "latest" | "preview";
