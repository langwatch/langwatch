import type { AccessDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import type { Actor } from "@langwatch/actor";
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DescribeRouteOptions } from "hono-openapi";
import type { RestVersionSelector } from "./rest-version-selector.ts";
import type { ApiSchema } from "../schema.ts";

import type { RateLimiter, ResponseCache } from "../ports.ts";
import type { IdempotentRunner } from "./idempotency.ts";
import { Temporal } from "@langwatch/time";

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
  const date = Temporal.PlainDate.from({ year: year!, month: month!, day: day! });

  return date.year === year && date.month === month && date.day === day;
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

/**
 * `head` is registered for the registry and the published document only: Hono
 * answers a HEAD request from the GET route BEFORE routing, so a HEAD handler
 * never runs. Register it beside the GET whose headers it describes.
 */
export type HttpMethod = "get" | "head" | "post" | "put" | "delete" | "patch";

/**
 * A body the framework must NOT parse: the handler is given the exact bytes,
 * which is what a webhook signature is computed over and what a protobuf
 * payload is. Read once by the framework, so nothing can consume the stream
 * twice.
 */
export type EndpointRawBody = Readonly<{
  as: "bytes" | "text";
  /** Documented request content type. Defaults by `as`. */
  contentType?: string;
}>;

/**
 * An answer that is not this framework's JSON: the handler returns a string,
 * bytes, a stream or a whole Response, and the framework writes it with the
 * content type and status the endpoint declared.
 */
export type EndpointRawResponse = Readonly<{
  contentType?: string;
  /** Why this endpoint answers outside the JSON contract. */
  reason: string;
}>;

/** What one replayable create declares. @see rest/idempotency.ts */
export type EndpointIdempotency = Readonly<{
  /** Folded into the receipt fingerprint, e.g. `webhooks.v1.endpoints.create`. */
  operation: string;
  /** The tenancy the caller's key is unique within, read off the request. */
  scope: (context: Context) => string;
  /**
   * A read-only check that runs OUTSIDE the ledger, on every request including
   * a replay. Authorization a create needs beyond the endpoint's own permission
   * belongs here: inside the handler it would be skipped on a replay, handing
   * back the stored answer on a grant the caller no longer holds.
   */
  preflight?: (context: Context, input: unknown) => void | Promise<void>;
}>;

/**
 * Context key holding the endpoint a request matched, as `METHOD /path`.
 */
export const ENDPOINT_ROUTE = "endpointRoute" as const;

/** Context key holding the complete validated input passed to a regular handler. */
export const ENDPOINT_INPUT = "endpointInput" as const;

/**
 * Context key holding the family that actually resolved the request.
 */
export const REQUEST_FAMILY = "requestFamily" as const;

/**
 * Context key marking that a request log record is already owed for this
 * request. See {@link REQUEST_FAMILY}: a request through twenty-one mounted
 * families would otherwise write twenty-one identical lines. The outermost
 * one owns the record; the rest stand down.
 */
export const REQUEST_LOG_CLAIM = "requestLogClaim" as const;

// ---------------------------------------------------------------------------
// Base app context (provider factories)
// ---------------------------------------------------------------------------

/**
 * The base request context handed to `.provide()` factories.
 */
export interface BaseApp<TProject = unknown> {
  project: TProject;
  _legacy: {
    organization: unknown;
    prisma: unknown;
  };
}

/**
 * A family's Hono app as a mount target.
 */
export type MountableRestApp = Hono<any, any, any>;

// ---------------------------------------------------------------------------
// Endpoint documentation (withDocs)
// ---------------------------------------------------------------------------

/**
 * OpenAPI documentation for an endpoint, declared via `.withDocs(...)`.
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
  /**
   * Hand-written operation parameters, appended after the ones the framework
   * derives (the version header, the idempotency key). A family that carries
   * its own path or query documentation because its handler parses the request
   * itself declares them here.
   */
  parameters?: DescribeRouteOptions["parameters"];
  /**
   * Hand-written request body documentation, replacing whatever the framework
   * would derive. For a family whose handler validates the body itself, this
   * is the only place the published shape can come from.
   */
  requestBody?: DescribeRouteOptions["requestBody"];
}

// ---------------------------------------------------------------------------
// Endpoint definition (what the definition chain produces)
// ---------------------------------------------------------------------------

/**
 * The resolved definition of one endpoint, produced by merging the service
 * defaults, the group defaults and the endpoint's own declaration chain
 * (service < group < endpoint; middleware concatenates in that order).
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
   */
  auth?: "default" | "none" | MiddlewareHandler;
  /** Permission enforced by the framework after authentication. */
  permission?: AuthzPermission;
  /**
   * The input field naming the scope the permission is about.
   */
  permissionScope?: string;
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
  /**
   * The create is replayable under `Idempotency-Key`; requires the
   * `idempotency` port on the service. @see rest/idempotency.ts
   */
  idempotency?: EndpointIdempotency;
  /** The request body reaches the handler unparsed. */
  rawBody?: EndpointRawBody;
  /** The answer is written outside the JSON contract. */
  rawResponse?: EndpointRawResponse;
  /** Response headers set on every answer this endpoint gives. */
  headers?: Readonly<Record<string, string>>;
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
 * resolved: identical to {@link EndpointDef}, except the two capabilities
 * with explicit opt-outs still carry their `false` markers.
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
 */
export type EndpointVariables = {
  // Validated at runtime by the declared SSE query schema; inference from
  // the trailing define callback is not expressible in TypeScript.
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
export type RequestActor = Actor;

// ---------------------------------------------------------------------------
// Route-mounting report
// ---------------------------------------------------------------------------

/**
 * One route registration on the built Hono app, reported to
 * `ServiceConfig.onRouteMounted`.
 */
export interface MountedRoute {
  /** Mounted HTTP method; SSE endpoints report `"get"`, guards `"all"`. */
  method: HttpMethod | "all";
  /** Absolute route path, including the service base path. */
  path: string;
  /**
   * The canonical `/api/v1` path this same mount also answers at, or absent
   * when the family already names a generation of its own. One logical route
   * with two addresses: consumers register one policy, not two.
   */
  canonicalPath?: string;
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
   * True for the catch-alls that 404 unknown version namespaces (and the bare paths that no
   * longer alias anything). They are real routes in the Hono route table and MUST be covered
   * by any route policy registry built from this callback.
   */
  isNamespaceGuard?: boolean;
  /** True for the public REST mount whose date version is optional in the URL. */
  isOptionalVersionRoute?: boolean;
  /**
   * The resolved endpoint definition behind this mount. Withdrawn mounts carry
   * the inherited definition (including `meta`); namespace guards carry `null`.
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
   * `context.authorize(permission)`. Static endpoint permissions still
   * belong on `.withPermission(...)`; this seam is for a permission
   * selected from validated request data.
   */
  authorize?: (context: Context, permission: AuthzPermission) => Promise<void>;
  /** @deprecated Legacy compatibility check; modern REST validates input before authorization. */
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
   * Receipt ledger backing `.withIdempotency(...)`. Declaring the capability
   * without the port fails the build; the ledger stays in the process that
   * owns a database and an encryption key.
   */
  idempotency?: IdempotentRunner;
  /** Custom error handler. If omitted the framework default is used. */
  onError?: (err: Error, c: Context) => Response | Promise<Response>;
  /**
   * Set `false` to keep the family off `/api/v1`. Reserved for a family whose
   * canonical path is already claimed by a different family — a legacy
   * surface superseded by a v1 one, or an alias fan-out that mounts its own.
   */
  v1Alias?: boolean;
  /**
   * Called synchronously during `build()` for every mounted route (each
   * dated version, `latest`, `preview`, withdrawn endpoints, the namespace
   * guards). Lets the host register route policies without re-deriving it.
   */
  onRouteMounted?: (route: MountedRoute) => void;
  /**
   * Mount one static API generation — `/api/gateway/v1`, `/api/scim/v2` —
   * instead of the dated namespaces. The family's basePath already carries the
   * generation segment, so the routes answer exactly where they do today.
   */
  staticVersioning?: StaticRestVersioning;
  /**
   * Mount each route ONCE, at the family's own base path, with no version
   * namespace of any kind. For the families based at bare `/api`, whose
   * published URLs are their whole contract and which cannot take a version
   * guard without shadowing every sibling mounted under the same prefix.
   */
  bareMount?: true;
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
  kind: "rest" | "public-rest" | "sse";
  method: HttpMethod | "sse" | "all";
  /** URL path fragment: `/${name}` for SSE, the path as-is for REST. */
  path: string;
  config: EndpointDef;
  handler: (...args: unknown[]) => unknown;
  withdrawn?: boolean;
}

// ---------------------------------------------------------------------------
// Version status (set as response header)
// ---------------------------------------------------------------------------

export type VersionStatus = "stable" | "latest" | "preview";
