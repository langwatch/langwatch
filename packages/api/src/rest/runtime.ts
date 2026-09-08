/**
 * The REST transport: the version vocabulary a family serves at, the `/api/v1`
 * alias every family answers under, the process-wide route-policy registry,
 * `defineRestRouter` (one complete declaration per route) and the one execution
 * path a mounted route runs — parse, authenticate, decide, handle, check the
 * answer, respond.
 */
import { actorSchema, type Actor } from "@langwatch/actor";
import type { AuthzDeclaredScopeId, AuthzPermission } from "@langwatch/authz-contract";
import { createLogger, validationMeta } from "@langwatch/observability";
import type { FeatureApiToken } from "@langwatch/runtime-composition";
import { Temporal } from "@langwatch/time";
import type { Context, ErrorHandler, Hono as HonoApp, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { mergePath } from "hono/utils/url";
import { uniqueSymbol, validator as openApiValidator } from "hono-openapi";
import { z } from "zod";

import {
  handlerManagedAuth,
  publicEndpoint,
  type AccessPolicy,
  type CredentialClass,
  type HandlerCredential,
} from "../access-policy.ts";
import {
  decide,
  SCOPE_INPUT_FIELDS,
  type AccessDenialPort,
  type AuthorizePort,
  type Credential,
  type PublicRouteAccess,
} from "../access/access.ts";
import { ApiVersionConflictError, InvalidApiVersionError } from "../errors.ts";
import type { ApiHandlerArguments } from "../handler-arguments.ts";
import { deprecatedAlias, deprecationNotice, documentRoute } from "./openapi.ts";
import {
  bodyLimit,
  defineRestMiddleware,
  loggerMiddleware,
  requestValidationErrorFrom,
  tracerMiddleware,
  type RestTransportMiddleware,
  type RestTransportMiddlewareBinding,
} from "./request.ts";
import { ENDPOINT_ROUTE, REQUEST_FAMILY, type RouteResponse } from "./response.ts";

const outputLogger = createLogger("langwatch:api:output-validation");

// ─────────────────────────────────────────────────────────────────────────────
// Version primitives.
// ─────────────────────────────────────────────────────────────────────────────

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

/** The version status header value a mount responds with. */
export type VersionStatus = "stable" | "latest" | "preview";

/**
 * `head` is registered for the registry and the published document only: Hono
 * answers a HEAD request from the GET route BEFORE routing, so a HEAD handler
 * never runs. Register it beside the GET whose headers it describes.
 */
export type HttpMethod = "get" | "head" | "post" | "put" | "delete" | "patch";

/** A family's Hono app as a mount target. */
export type MountableRestApp = Hono<any, any, any>;

/**
 * The one dated version every management API family serves.
 *
 * The management surface shipped as a single product decision, so its families
 * version together: a caller pins `/api/<family>/2026-08-07/...` and gets the
 * same vintage everywhere, and a future breaking change bumps this constant in
 * exactly one place per family.
 */
export const MANAGEMENT_API_VERSION = "2026-08-07";

const DATE_VERSION_RE = /^20\d{2}-\d{2}-\d{2}$/;

/** Returns true when `value` is a real calendar date in `YYYY-MM-DD` form. */
export function isDateVersion(value: string): value is DateVersion {
  if (!DATE_VERSION_RE.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = Temporal.PlainDate.from({ year: year!, month: month!, day: day! });

  return date.year === year && date.month === month && date.day === day;
}

/** Asserts the version argument of a declaration. */
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

// ─────────────────────────────────────────────────────────────────────────────
// The canonical `/api/v1` alias every `/api` family answers under.
// ─────────────────────────────────────────────────────────────────────────────

/** The canonical published API generation. */
export const V1_PREFIX = "/api/v1";

const VERSION_SEGMENT = /^v\d+$/;

/**
 * The `/api/v1` form of a bare `/api/...` route path, or `null` when the path
 * must not be aliased.
 */
export function canonicalV1Path(path: string): string | null {
  if (path !== "/api" && !path.startsWith("/api/")) return null;
  const rest = path.slice("/api".length);
  if (rest === "" || rest === "/") return null;
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => VERSION_SEGMENT.test(segment))) return null;
  return `${V1_PREFIX}${rest}`;
}

/** The same handler stack with hono-openapi's route metadata detached. */
export function undescribedStack(stack: readonly MiddlewareHandler[]): MiddlewareHandler[] {
  return stack.map((handler) => {
    if (Reflect.get(handler, uniqueSymbol) === void 0) return handler;
    const passthrough: MiddlewareHandler = async (context, next) => handler(context, next);
    return passthrough;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Static generation selection, for a surface whose contract is a generation
// rather than a date.
// ─────────────────────────────────────────────────────────────────────────────

export type RestVersionSource = "path" | "header" | "latest";

export type RestVersionSelection = Readonly<{
  version: string;
  source: RestVersionSource;
}>;

export type RestVersionSelectorOptions = Readonly<{
  versions: readonly string[];
  latestVersion: string;
  headerName?: string;
}>;

export type RestVersionSelectorMiddlewareOptions = Readonly<{
  selector: RestVersionSelector;
  pathVersion?: string;
}>;

/**
 * Selects a static public-REST generation independently from date contract
 * negotiation. A feature mount supplies its explicit path generation, if any.
 */
export class RestVersionSelector {
  static create(options: RestVersionSelectorOptions): RestVersionSelector {
    return new RestVersionSelector(options);
  }

  readonly headerName: string;
  private readonly versions: ReadonlySet<string>;
  private readonly latestVersion: string;

  private constructor({
    headerName = API_VERSION_HEADER,
    latestVersion,
    versions,
  }: RestVersionSelectorOptions) {
    if (versions.length === 0) {
      throw new Error("REST version selector requires at least one supported version");
    }
    if (new Set(versions).size !== versions.length) {
      throw new Error("REST version selector versions must be unique");
    }
    if (versions.some((version) => version.trim() === "")) {
      throw new Error("REST version selector versions must not be blank");
    }
    if (!versions.includes(latestVersion)) {
      throw new Error("REST version selector latestVersion must be supported");
    }
    if (headerName.trim() === "") {
      throw new Error("REST version selector headerName must not be blank");
    }

    this.headerName = headerName;
    this.versions = new Set(versions);
    this.latestVersion = latestVersion;
  }

  select({
    pathVersion,
    headerVersion,
  }: Readonly<{ pathVersion?: string; headerVersion?: string }>): RestVersionSelection {
    if (pathVersion !== void 0 && headerVersion !== void 0 && pathVersion !== headerVersion) {
      throw new ApiVersionConflictError();
    }
    if (pathVersion !== void 0) {
      this.assertSupported(pathVersion);
    }
    if (headerVersion !== void 0) {
      this.assertSupported(headerVersion);
    }
    if (pathVersion !== void 0) {
      return { version: pathVersion, source: "path" };
    }
    if (headerVersion !== void 0) {
      return { version: headerVersion, source: "header" };
    }
    return { version: this.latestVersion, source: "latest" };
  }

  private assertSupported(version: string): void {
    if (!this.versions.has(version)) {
      const supported = [...this.versions].join(", ");
      throw new InvalidApiVersionError(`one of ${supported}`);
    }
  }
}

/** Applies static generation negotiation to a hand-mounted REST transport. */
export function restVersionSelectorMiddleware({
  pathVersion,
  selector,
}: RestVersionSelectorMiddlewareOptions): MiddlewareHandler {
  return async (context, next) => {
    const selection = selector.select({
      pathVersion,
      headerVersion: context.req.header(selector.headerName) ?? void 0,
    });
    try {
      await next();
    } finally {
      context.header(API_VERSION_HEADER, selection.version);
      context.header("X-API-Version-Status", selection.source === "latest" ? "latest" : "stable");
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The process-wide route-policy registry.
//
// Populated as each family mounts. The router-introspection guard cross-checks
// the composed router against it, so any mounted route lacking a declared
// policy — even one that bypassed the runtime — fails CI.
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
  readonly policy: AccessPolicy;
  readonly family: string;
  /**
   * Which credential an API consumer sends here. Derived by the runtime from
   * the mount and the route, so a route cannot claim a credential class
   * nothing enforces. Read by the OpenAPI generator to stamp each operation's
   * `security`.
   */
  readonly credentialClass: CredentialClass;
  /**
   * The `/api/v1` path this same route also answers at. One logical route with
   * two addresses, so an authorization audit and the document's drift guard
   * count it once and still recognise the canonical published URL.
   */
  readonly canonicalPath?: string;
  /**
   * True when this mount answers 410 Gone for a withdrawn endpoint. No handler
   * stands behind it, so the route-coverage gate accounts for it by shape.
   */
  readonly withdrawn?: boolean;
  /**
   * True for the catch-alls that 404 an unknown version namespace. Real routes
   * in the table, and undocumentable for the same reason a tombstone is.
   */
  readonly isNamespaceGuard?: boolean;
}

const registry = new Map<string, RegisteredRoute>();

function registryKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Record (or overwrite, idempotently) the policy for a (method, path). */
export function registerRoutePolicy(route: RegisteredRoute): void {
  registry.set(registryKey(route.method, route.path), {
    ...route,
    method: route.method.toUpperCase(),
  });
}

export function getRoutePolicy(method: string, path: string): RegisteredRoute | undefined {
  return registry.get(registryKey(method, path));
}

export function allRegisteredRoutes(): RegisteredRoute[] {
  return [...registry.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// `defineRestRouter`: one complete declaration per route, under a namespace and
// a version. REST shares no declaration with a browser client the way tRPC
// does, so each route states its whole identity here.
// ─────────────────────────────────────────────────────────────────────────────

/** The portable part of a feature API token; no runtime-composition dependency. */
export type FeatureApiWitness<Api> = FeatureApiToken<Api>;

type SourceSchema = z.ZodObject | z.ZodDiscriminatedUnion<readonly z.ZodObject[]>;
type Missing = undefined;
type RouteSource = SourceSchema | Missing;
type PathParameterNames<Path extends string> = Path extends `${string}:${infer Tail}`
  ? Tail extends `${infer Name}/${infer Rest}`
    ? Name | PathParameterNames<`/${Rest}`>
    : Tail
  : never;
type ExactPathSchema<Path extends string, Schema extends z.ZodObject> =
  Exclude<keyof Schema["shape"], PathParameterNames<Path>> extends never
    ? Exclude<PathParameterNames<Path>, keyof Schema["shape"]> extends never
      ? Schema
      : never
    : never;
type UnionKeys<Value> = Value extends unknown ? keyof Value : never;
type DistinctSchema<
  Schema extends SourceSchema,
  Other extends RouteSource,
> = Other extends SourceSchema
  ? Extract<UnionKeys<z.output<Schema>>, UnionKeys<z.output<Other>>> extends never
    ? Schema
    : never
  : Schema;
type SourceInput<Schema extends RouteSource> = Schema extends SourceSchema
  ? z.output<Schema>
  : unknown;
type RouteInput<Params extends RouteSource, Query extends RouteSource, Body extends RouteSource> = [
  Params,
  Query,
  Body,
] extends [Missing, Missing, Missing]
  ? undefined
  : SourceInput<Params> & SourceInput<Query> & SourceInput<Body>;
type OutputSchema = z.ZodObject | z.ZodArray | z.ZodVoid | z.ZodUndefined;

export type RestTransportDocs = Readonly<{
  readonly summary?: string;
  readonly description?: string;
  /** The groups the operation is filed under in the published reference. */
  readonly tags?: readonly string[];
  /**
   * The answers the operation documents beyond its declared success, built by
   * `documentedResponses`. Merged over the generated success block.
   */
  readonly responses?: Readonly<Record<number, RouteResponse>>;
}>;

/**
 * How a family is addressed. `dated` publishes the namespace's dated, latest
 * and bare paths with their `/api/v1` twins; `v1-only` publishes exactly
 * `/api/v1/<namespace>/...` and nothing else, for a surface whose published
 * generation is its whole contract.
 */
export type RestAddressing = "dated" | "v1-only";

/**
 * What a project-scoped door knows about the caller beyond the request's own
 * input: the slug a platform URL is built from, the person a personal view is
 * filtered for, and the actor an action is recorded against. Named here, in the
 * file that binds facts, so every project family declares the same one.
 */
export const projectRestFacts = defineRestMiddleware(
  "projectRestFacts",
  z.object({
    projectSlug: z.string(),
    viewerUserId: z.string().nullable(),
    actorId: z.string(),
  }),
);

/** What a superseded family or route answers with, and what replaces it. */
export type RestDeprecation = Readonly<{
  /** The path of the family or route that replaces this one. */
  readonly successor: string;
  readonly notice?: string;
}>;

/**
 * The credentials a declaration may choose a door for. `session`,
 * `internalSecret` and `public` are absent on purpose: no door resolves a
 * declared scope for them yet, so a declaration naming one would type its
 * handler's scope as a value nothing establishes. Those arrive with their own
 * doors; until then a family serving one names it on the mount instead.
 */
export type RestDoorCredential = Extract<Credential, "projectKey" | "organizationKey">;

/**
 * Which scope tier each door's credential resolves. The one table: the type
 * a handler reads and the tier the runtime asserts both come from here, so a
 * door cannot promise one tier and hand over another.
 */
const DOOR_SCOPE_TIER = {
  projectKey: "project",
  organizationKey: "organization",
} as const satisfies Record<RestDoorCredential, AuthzDeclaredScopeId["tier"]>;

/** The scope a handler on `Door` is handed: the tier that door resolves. */
type DoorScope<Door extends RestDoorCredential> = Extract<
  AuthzDeclaredScopeId,
  { tier: (typeof DOOR_SCOPE_TIER)[Door] }
>;
type ScopedHandlerArguments<Input, App, Door extends RestDoorCredential> = Omit<
  ApiHandlerArguments<Input, App>,
  "scope"
> & {
  readonly scope: DoorScope<Door>;
};
/** A public route resolves no credential, so it knows neither actor nor scope. */
type PublicHandlerArguments<Input, App> = Omit<
  ApiHandlerArguments<Input, App>,
  "actor" | "scope"
> & {
  readonly actor: null;
  readonly scope: null;
};
type HandlerArgumentsFor<
  Access extends RouteAccessKind,
  Input,
  App,
  Door extends RestDoorCredential,
> = Access extends "public"
  ? PublicHandlerArguments<Input, App>
  : ScopedHandlerArguments<Input, App, Door>;
type RouteAccessKind = "scoped" | "public";
type StoredHandler<Api> = {
  invoke(
    args:
      | ScopedHandlerArguments<unknown, Api, RestDoorCredential>
      | PublicHandlerArguments<unknown, Api>,
    ...facts: unknown[]
  ): unknown;
}["invoke"];
type MiddlewareFacts<Middleware extends readonly RestTransportMiddleware[]> = {
  [Index in keyof Middleware]: z.output<Middleware[Index]["schema"]>;
};
type RouteResult<Output extends OutputSchema | Missing> = Output extends OutputSchema
  ? z.input<Output> | Promise<z.input<Output>>
  : void | Promise<void>;

export type RestTransportRoute<Api> = Readonly<{
  readonly method: HttpMethod;
  readonly path: string;
  readonly operation: string;
  readonly version: DateVersion;
  readonly docs?: RestTransportDocs;
  readonly params?: z.ZodObject;
  readonly input?: SourceSchema;
  /** Absent exactly when the route declared public access instead. */
  readonly permission?: AuthzPermission;
  /** Present exactly when the route answers with no credential. */
  readonly access?: PublicRouteAccess;
  readonly permissionScope?: string;
  readonly query?: z.ZodObject;
  readonly output: OutputSchema;
  readonly status?: ContentfulStatusCode;
  readonly middleware?: readonly RestTransportMiddleware[];
  readonly bodyLimit?: Readonly<{ maxBytes: number; onExceeded(): Error }>;
  readonly deprecated?: RestDeprecation;
  readonly handler: StoredHandler<Api>;
}>;

/** Inert REST transport metadata consumed by a process-owned mount adapter. */
export type RestTransportDeclaration<Api> = Readonly<{
  readonly protocol: "rest";
  readonly api: FeatureApiWitness<Api>;
  /** The family's own path segment: `/api/<namespace>`. */
  readonly namespace: string;
  readonly version: DateVersion;
  readonly addressing: RestAddressing;
  /**
   * The door these routes are answered behind, and so the scope every handler
   * is handed. Declared, not mounted: the handler's own type follows it.
   */
  readonly credential: RestDoorCredential;
  /** Applies to every route the family declares, unless a route names its own. */
  readonly deprecated?: RestDeprecation;
  readonly routes: readonly RestTransportRoute<Api>[];
}>;

type RouteReady<
  Path extends string,
  Params extends RouteSource,
  Permission extends boolean,
> = Permission extends true
  ? PathParameterNames<Path> extends never
    ? true
    : Params extends SourceSchema
      ? true
      : false
  : false;

class RouteBuilder<
  Api,
  Method extends HttpMethod,
  Path extends string,
  Params extends RouteSource = Missing,
  Body extends RouteSource = Missing,
  Query extends RouteSource = Missing,
  Output extends OutputSchema | Missing = Missing,
  Permission extends boolean = false,
  Middleware extends readonly RestTransportMiddleware[] = [],
  Access extends RouteAccessKind = "scoped",
  Door extends RestDoorCredential = "projectKey",
> {
  constructor(
    private readonly router: RestTransportRouter<Api, Door>,
    private readonly method: Method,
    private readonly path: Path,
    private readonly operation: string,
    private readonly state: Readonly<{
      params?: z.ZodObject;
      input?: SourceSchema;
      query?: z.ZodObject;
      output?: OutputSchema;
      permission?: AuthzPermission;
      access?: PublicRouteAccess;
      version?: DateVersion;
      docs?: RestTransportDocs;
      status?: ContentfulStatusCode;
      middleware?: readonly RestTransportMiddleware[];
      bodyLimit?: Readonly<{ maxBytes: number; onExceeded(): Error }>;
      deprecated?: RestDeprecation;
    }> = {},
  ) {}

  withParams<Schema extends z.ZodObject>(
    schema: ExactPathSchema<Path, Schema> &
      DistinctSchema<Schema, Body> &
      DistinctSchema<Schema, Query>,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Schema,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("params", this.state.params);
    assertPathParameters(this.path, schema);
    assertDistinctSources(schema, this.state.input);
    assertDistinctSources(schema, this.state.query);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      params: schema,
    });
  }

  withInput<Schema extends SourceSchema>(
    this: RouteBuilder<
      Api,
      Exclude<HttpMethod, "get" | "head">,
      Path,
      Params,
      Body,
      Query,
      Output,
      Permission,
      Middleware,
      Access,
      Door
    >,
    schema: Schema & DistinctSchema<Schema, Params> & DistinctSchema<Schema, Query>,
  ): RouteBuilder<
    Api,
    Exclude<HttpMethod, "get" | "head">,
    Path,
    Params,
    Schema,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertBodyMethod(this.method, this.path);
    assertSourceUnset("input", this.state.input);
    assertDistinctSources(this.state.params, schema);
    assertDistinctSources(this.state.query, schema);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      input: schema,
    });
  }

  withQuery<Schema extends z.ZodObject>(
    schema: Schema & DistinctSchema<Schema, Params> & DistinctSchema<Schema, Body>,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Schema,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("query", this.state.query);
    assertDistinctSources(this.state.params, schema);
    assertDistinctSources(this.state.input, schema);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      query: schema,
    });
  }

  withPermission(
    permission: AuthzPermission,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    true,
    Middleware,
    Access,
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      permission,
    });
  }

  /**
   * Declares the route unauthenticated. It resolves no credential and no
   * scope, so its handler is handed a null actor and a null scope, and the
   * document publishes it with no security requirement.
   */
  withAccess(
    access: PublicRouteAccess,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    true,
    Middleware,
    "public",
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      access,
    });
  }

  withVersion(
    version: DateVersion,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertVersionLabel(version);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      version,
    });
  }

  withDocs(
    docs: RestTransportDocs,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      docs,
    });
  }

  /** Marks this one route superseded, whatever the family declared. */
  withDeprecated(
    deprecated: RestDeprecation,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      deprecated,
    });
  }

  withOutput<Schema extends OutputSchema>(
    schema: Schema,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Schema,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("output", this.state.output);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      output: schema,
    });
  }

  handle<TResult extends RouteResult<Output>>(
    this: RouteReady<Path, Params, Permission> extends true
      ? RouteBuilder<
          Api,
          Method,
          Path,
          Params,
          Body,
          Query,
          Output,
          Permission,
          Middleware,
          Access,
          Door
        >
      : never,
    handler: (
      args: HandlerArgumentsFor<Access, RouteInput<Params, Query, Body>, Api, Door>,
      ...facts: MiddlewareFacts<Middleware>
    ) => TResult,
  ): RestTransportRouter<Api, Door> {
    assertRouteReady({
      method: this.method,
      path: this.path,
      operation: this.operation,
      state: this.state,
    });

    this.router.assertRouteAvailable(this.method, this.path, this.operation);

    this.router.routes.push({
      method: this.method,
      path: this.path,
      operation: this.operation,
      version: this.state.version ?? this.router.version,
      ...(this.state.docs ? { docs: this.state.docs } : {}),
      ...(this.state.params ? { params: this.state.params } : {}),
      ...(this.state.input ? { input: this.state.input } : {}),
      ...(this.state.query ? { query: this.state.query } : {}),
      ...(this.state.access
        ? { access: this.state.access }
        : { permission: permissionOf(this.state.permission) }),
      output: this.state.output ?? z.void(),
      ...(this.state.status === void 0 ? {} : { status: this.state.status }),
      ...(this.state.middleware ? { middleware: this.state.middleware } : {}),
      ...(this.state.bodyLimit ? { bodyLimit: this.state.bodyLimit } : {}),
      ...(this.state.deprecated ? { deprecated: this.state.deprecated } : {}),
      handler: handler as StoredHandler<Api>,
    });

    return this.router;
  }

  withStatus(
    status: ContentfulStatusCode,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    if (!Number.isInteger(status) || status < 200 || status > 299) {
      throw new Error(
        "REST JSON success status must be 200–299 except 204; omit output for no content",
      );
    }

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      status,
    });
  }

  withBodyLimit(
    limit: Readonly<{ maxBytes: number; onExceeded(): Error }>,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    if (!Number.isSafeInteger(limit.maxBytes) || limit.maxBytes < 0)
      throw new Error("REST body limit must be a non-negative safe integer");

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      bodyLimit: limit,
    });
  }

  withMiddleware<const Added extends readonly RestTransportMiddleware[]>(
    ...middleware: Added
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    [...Middleware, ...Added],
    Access,
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      middleware: [...(this.state.middleware ?? []), ...middleware],
    });
  }
}

/** A route just opened on a family's door: nothing declared but its address. */
type OpenRoute<
  Api,
  Method extends HttpMethod,
  Path extends string,
  Door extends RestDoorCredential,
> = RouteBuilder<Api, Method, Path, Missing, Missing, Missing, Missing, false, [], "scoped", Door>;

class RestTransportRouter<Api, Door extends RestDoorCredential = "projectKey"> {
  readonly routes: RestTransportRoute<Api>[] = [];
  private addressing: RestAddressing = "dated";
  private deprecated: RestDeprecation | undefined;

  constructor(
    private readonly api: FeatureApiWitness<Api>,
    readonly namespace: string,
    readonly version: DateVersion,
    readonly credential: Door,
  ) {}

  /**
   * The door this family's routes answer behind. Declared before the first
   * route, because it decides the scope every handler is handed: a route
   * declared under it reads `scope.tier` as the credential's own tier.
   */
  withCredential<NewDoor extends RestDoorCredential>(
    credential: NewDoor,
  ): RestTransportRouter<Api, NewDoor> {
    if (this.routes.length > 0) {
      throw new Error(`REST "${this.namespace}" must declare its credential before its routes`);
    }

    const router = new RestTransportRouter<Api, NewDoor>(
      this.api,
      this.namespace,
      this.version,
      credential,
    );

    router.addressing = this.addressing;
    router.deprecated = this.deprecated;

    return router;
  }

  /**
   * How the family is addressed. Declared before the first route, because it
   * decides which paths every route in the family answers at.
   */
  withAddressing(addressing: RestAddressing): RestTransportRouter<Api, Door> {
    if (this.routes.length > 0) {
      throw new Error(`REST "${this.namespace}" must declare its addressing before its routes`);
    }

    this.addressing = addressing;

    return this;
  }

  /** Marks every route of the family superseded by `successor`. */
  withDeprecated(deprecated: RestDeprecation): RestTransportRouter<Api, Door> {
    this.deprecated = deprecated;

    return this;
  }

  /** The inert declaration a feature installer retains and a process mounts. */
  build(): Readonly<{
    protocol: "rest";
    namespace: string;
    router: () => RestTransportDeclaration<Api>;
  }> {
    const declaration: RestTransportDeclaration<Api> = {
      protocol: "rest",
      api: this.api,
      namespace: this.namespace,
      version: this.version,
      addressing: this.addressing,
      credential: this.credential,
      ...(this.deprecated ? { deprecated: this.deprecated } : {}),
      routes: this.routes,
    };

    return { protocol: "rest", namespace: this.namespace, router: () => declaration };
  }

  get<Path extends string>(path: Path, operation: string): OpenRoute<Api, "get", Path, Door> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "get", path, operation);
  }

  patch<Path extends string>(path: Path, operation: string): OpenRoute<Api, "patch", Path, Door> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "patch", path, operation);
  }

  post<Path extends string>(path: Path, operation: string): OpenRoute<Api, "post", Path, Door> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "post", path, operation);
  }

  put<Path extends string>(path: Path, operation: string): OpenRoute<Api, "put", Path, Door> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "put", path, operation);
  }

  delete<Path extends string>(path: Path, operation: string): OpenRoute<Api, "delete", Path, Door> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "delete", path, operation);
  }

  assertRouteAvailable(method: HttpMethod, path: string, operation: string): void {
    if (this.routes.some((route) => route.method === method && route.path === path)) {
      throw new Error(`REST ${method.toUpperCase()} ${path} is already registered`);
    }

    if (this.routes.some((route) => route.operation === operation)) {
      throw new Error(`REST operation "${operation}" is already registered`);
    }
  }
}

/**
 * Opens a feature's REST surface. Each route is one complete declaration —
 * method, path, sources, permission, answer and documentation — because REST
 * shares no declaration with a browser client the way tRPC does.
 */
export function defineRestRouter<Api>(api: FeatureApiWitness<Api>) {
  return {
    /** The family's own path segment: the routes answer under `/api/<namespace>`. */
    withNamespace(namespace: string) {
      assertNamespace(namespace);

      return {
        withVersion(version: DateVersion): RestTransportRouter<Api, "projectKey"> {
          assertVersionLabel(version);

          return new RestTransportRouter<Api, "projectKey">(
            api,
            namespace,
            version,
            "projectKey",
          );
        },
      };
    },
  };
}

function assertNamespace(namespace: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(namespace)) {
    throw new Error(`REST namespace "${namespace}" must be lower kebab case`);
  }
}

function assertPathParameters(path: string, schema: z.ZodObject): void {
  const expected = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!);
  const actual = Object.keys(schema.shape);

  if (expected.length !== actual.length || expected.some((name) => !actual.includes(name))) {
    throw new Error(`REST path "${path}" parameters must exactly match withParams()`);
  }
}

function assertSupportedPath(path: string): void {
  if (/:[A-Za-z0-9_]+[?+*]/.test(path)) {
    throw new Error(`REST path "${path}" uses unsupported optional or repeated parameters`);
  }
}

function assertDistinctSources(
  left: SourceSchema | undefined,
  right: SourceSchema | undefined,
): void {
  if (!left || !right) return;

  const rightKeys = new Set(sourceKeys(right));
  const duplicate = sourceKeys(left).find((key) => rightKeys.has(key));

  if (duplicate) {
    throw new Error(`REST input field "${duplicate}" is declared by multiple sources`);
  }
}

function sourceKeys(schema: SourceSchema): string[] {
  return schema instanceof z.ZodObject
    ? Object.keys(schema.shape)
    : schema.options.flatMap((option) => Object.keys(option.shape));
}

function assertSourceUnset(source: string, schema: unknown): void {
  if (schema !== void 0) {
    throw new Error(
      `REST route already declared with${source[0]!.toUpperCase()}${source.slice(1)}()`,
    );
  }
}

function assertBodyMethod(method: HttpMethod, path: string): void {
  if (method === "get" || method === "head") {
    throw new Error(`REST ${method.toUpperCase()} ${path} cannot declare a JSON body`);
  }
}

function assertRouteReady({
  method,
  path,
  operation,
  state,
}: {
  method: HttpMethod;
  path: string;
  operation: string;
  state: Readonly<{
    params?: z.ZodObject;
    permission?: AuthzPermission;
    access?: PublicRouteAccess;
    query?: z.ZodObject;
    input?: SourceSchema;
    output?: OutputSchema;
  }>;
}): void {
  if (!state.permission && !state.access) {
    throw new Error(`REST ${operation} must declare withPermission() or withAccess()`);
  }

  if (state.permission && state.access) {
    throw new Error(`REST ${operation} declares both a permission and public access`);
  }

  if (state.access) assertNoScopeInput({ operation, state });

  if (/:([A-Za-z0-9_]+)/.test(path) && !state.params) {
    throw new Error(`REST ${method.toUpperCase()} ${path} must declare withParams()`);
  }
}

/**
 * A public route answers before any scope is resolved, so a scope field in its
 * own input would be a tenant the request names and nothing checks.
 */
function assertNoScopeInput({
  operation,
  state,
}: {
  operation: string;
  state: Readonly<{ params?: z.ZodObject; query?: z.ZodObject; input?: SourceSchema }>;
}): void {
  const declared = [state.params, state.query, state.input]
    .filter((schema): schema is SourceSchema => schema !== void 0)
    .flatMap((schema) => sourceKeys(schema));

  const named = SCOPE_INPUT_FIELDS.find((field) => declared.includes(field));

  if (named) {
    throw new Error(
      `REST ${operation} answers without a credential, so it cannot take "${named}" as input`,
    );
  }
}

function permissionOf(permission: AuthzPermission | undefined): AuthzPermission {
  if (!permission) throw new Error("REST route must declare withPermission()");

  return permission;
}

// ─────────────────────────────────────────────────────────────────────────────
// The one REST execution path: parse, authenticate, decide, handle, check the
// answer, respond. The request is parsed BEFORE the credential is resolved, so
// a malformed body is refused without ever touching the caller's key.
//
// A route answers at three addresses — its dated namespace, `latest`, and the
// family's bare path — plus the `/api/v1` twin of each, and any real date the
// caller pins dispatches to the latest registration on or before it.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_PARAMS = "routeParams" as const;
const VERSION_REQUEST = "apiVersionRequest" as const;
const ROUTE_INPUT = "endpointInput" as const;

/** Who the family's own door authenticated, and what its credential resolved. */
export type RestCaller = Readonly<{
  actor: Actor | null;
  scope: AuthzDeclaredScopeId;
  /** Called only after the handler answered, for a credential that records use. */
  markUsed?: () => void;
}>;

/** Everything the process supplies for the path to run. */
export type RestRuntimePorts = Readonly<{
  identity: Readonly<{
    authenticate(input: {
      request: Request;
      permission: AuthzPermission;
    }): Promise<RestCaller> | RestCaller;
  }>;
  /** Only a family whose routes carry a check of their own supplies these. */
  authorization?: Readonly<{ forRequest(request: Request): AuthorizePort }>;
  denials?: AccessDenialPort;
  /** Where the first call of each deprecated route is recorded. */
  deprecationLog?: RestDeprecationLogPort;
}>;

/**
 * Told once per process the first time a deprecated route is called, so an
 * operator learns a superseded endpoint is still in use without a line per
 * request. Defaults to doing nothing.
 */
export type RestDeprecationLogPort = Readonly<{
  deprecatedRouteCalled(input: {
    family: string;
    operation: string;
    successor: string;
    notice: string;
  }): void;
}>;

/** What one family's mount states beyond its declaration. */
export type RestMountOptions<Api> = Readonly<{
  app: () => Api;
  /**
   * Which credential reaches these routes, as the document names it. The
   * declaration names its own door; this states the classes a declaration
   * cannot name yet — `public`, `session`, `internalSecret` — and naming a
   * door credential that disagrees with the declaration's is refused at mount.
   */
  credential?: Credential;
  /** The family's own error boundary: it renders every refusal these routes raise. */
  onError: ErrorHandler;
  /** Applied under the family's paths before any route: the app container. */
  middleware?: readonly MiddlewareHandler[];
  /**
   * One binding per fact the declaration's routes name. A declared fact with
   * no binding here is refused at mount rather than reaching a handler unset.
   */
  facts?: readonly RestTransportMiddlewareBinding[];
  /** Why the door, rather than a middleware chain, is what enforces the route. */
  reason?: string;
}>;

/** Mounts declared REST families on one process's own doors. */
export interface RestRuntime {
  mount<Api>(declaration: RestTransportDeclaration<Api>, options: RestMountOptions<Api>): HonoApp;
}

const HOST_ENFORCED = "project credential and permission enforced by the transport host";

/** Builds one process's REST path. */
export function createRestRuntime(ports: RestRuntimePorts): RestRuntime {
  return {
    mount: (declaration, options) => {
      const v1Only = declaration.addressing === "v1-only";
      const basePath = v1Only
        ? `${V1_PREFIX}/${declaration.namespace}`
        : `/api/${declaration.namespace}`;
      const app = new Hono();
      const aliasPath = canonicalV1Path(basePath);
      const scopes = aliasPath ? [`${basePath}/*`, `${aliasPath}/*`] : [`${basePath}/*`];
      const facts = factBindings({ declaration, options });
      const credential = mountCredential({ declaration, options });

      for (const middleware of [
        tracerMiddleware({ name: declaration.namespace }),
        loggerMiddleware({ name: declaration.namespace }),
        ...(options.middleware ?? []),
      ]) {
        for (const scope of scopes) app.use(scope, middleware);
      }

      for (const route of declaration.routes) {
        for (const mount of addressesOf({ route, declaration })) {
          mountRoute({
            app,
            basePath,
            method: route.method,
            path: mount.path,
            stack: routeStack({
              route,
              declaration,
              ports,
              options,
              facts,
              ...mount.context,
            }),
            policy: registryPolicy({ route, options, credential }),
            credentialClass: route.access ? "none" : CREDENTIAL_CLASS[credential],
            family: declaration.namespace,
          });
        }
      }

      if (!v1Only) mountVersionGuards({ app, basePath, declaration, ports, options, facts });
      app.onError(options.onError);

      return app;
    },
  };
}

/**
 * Every binding the declaration's facts need, checked once at mount. A fact
 * the mount did not bind is refused here, naming the fact and the route,
 * rather than reaching a handler as an unset argument.
 */
function factBindings<Api>({
  declaration,
  options,
}: {
  declaration: RestTransportDeclaration<Api>;
  options: RestMountOptions<Api>;
}): ReadonlyMap<string, RestTransportMiddlewareBinding> {
  const bound = new Map(
    (options.facts ?? []).map((binding) => [binding.middleware.name, binding] as const),
  );

  for (const route of declaration.routes) {
    for (const fact of route.middleware ?? []) {
      if (bound.has(fact.name)) continue;

      throw new Error(
        `REST ${route.method.toUpperCase()} /api/${declaration.namespace}${route.path} declares ` +
          `the fact "${fact.name}", and this mount bound no value for it`,
      );
    }
  }

  return bound;
}

/** The addresses one route answers at, and what each one reports. */
function addressesOf({
  route,
  declaration,
}: {
  route: RestTransportRoute<unknown>;
  declaration: RestTransportDeclaration<unknown>;
}): readonly {
  path: string;
  context: { version: string; status: VersionStatus; suffix?: string };
}[] {
  const version = declaration.version;
  // A collection route's path is the family root, so it contributes nothing to
  // an address: concatenating it would date the namespace as `/<version>/`,
  // which no caller sends and a sibling `/:id` answers instead.
  const suffix = route.path === "/" ? "" : route.path;

  // A v1-only family's published generation IS its contract: one address, no
  // dated namespace, no latest alias, and nothing for a date to fall back to.
  if (declaration.addressing === "v1-only") {
    return [{ path: suffix || "/", context: { version, status: "stable" } }];
  }

  return [
    { path: `/${version}${suffix}`, context: { version, status: "stable", suffix: dated(version) } },
    {
      path: `/${VERSION_LATEST}${suffix}`,
      context: { version: VERSION_LATEST, status: "latest", suffix: VERSION_LATEST },
    },
    { path: suffix || "/", context: { version: VERSION_LATEST, status: "latest" } },
  ];
}

function dated(version: string): string {
  return version.replaceAll("-", "_");
}

/**
 * The whole stack for one mount of one route: the version headers, the
 * document block, the validators, the merged input and the handler.
 */
function routeStack<Api>({
  route,
  declaration,
  ports,
  options,
  facts,
  version,
  status,
  suffix,
  paramSource = "route",
  documented = true,
}: {
  route: RestTransportRoute<Api>;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
  version: string;
  status: VersionStatus;
  suffix?: string | undefined;
  paramSource?: "route" | "context";
  documented?: boolean;
}): MiddlewareHandler[] {
  const limit = route.bodyLimit;
  const family = declaration.namespace;
  const deprecated = route.deprecated ?? declaration.deprecated;

  return [
    versionContext({ route, family, version, status }),
    ...(documented ? [documentRoute({ route, suffix, ...(deprecated ? { deprecated } : {}) })] : []),
    // Ahead of everything that can refuse: a deprecated endpoint's answer says
    // so whether it succeeded or not.
    ...(deprecated
      ? [deprecatedAlias(deprecated), deprecationLog({ route, family, deprecated, ports })]
      : []),
    // Ahead of the validators: they read the body to parse it, and a stream
    // read once cannot be drained again to measure it.
    ...(limit
      ? [
          bodyLimit({
            maxSize: limit.maxBytes,
            onError: () => {
              throw limit.onExceeded();
            },
          }),
        ]
      : []),
    ...validators({ route, documented, paramSource }),
    inputMiddleware({ route, paramSource }),
    handlerMiddleware({ route, credential: declaration.credential, ports, options, facts }),
  ];
}

/** Every deprecated route is reported once per process, on its first call. */
const reportedDeprecations = new Set<string>();

function deprecationLog<Api>({
  route,
  family,
  deprecated,
  ports,
}: {
  route: RestTransportRoute<Api>;
  family: string;
  deprecated: RestDeprecation;
  ports: RestRuntimePorts;
}): MiddlewareHandler {
  const key = `${family} ${route.operation}`;

  return async (context, next) => {
    if (!reportedDeprecations.has(key)) {
      reportedDeprecations.add(key);
      ports.deprecationLog?.deprecatedRouteCalled({
        family,
        operation: route.operation,
        successor: deprecated.successor,
        notice: deprecationNotice(deprecated),
      });
    }

    await next();
  };
}

/**
 * The route's own identity on the request, and the version headers every
 * answer carries — set in a `finally` so a refusal carries them too.
 */
function versionContext({
  route,
  family,
  version,
  status,
}: {
  route: RestTransportRoute<unknown>;
  family: string;
  version: string;
  status: VersionStatus;
}): MiddlewareHandler {
  // Built once per mount: the registered path and method cannot change after.
  const identity = `${route.method.toUpperCase()} ${route.path || "/"}`;

  return async (context, next) => {
    context.set(ENDPOINT_ROUTE, identity);
    context.set(REQUEST_FAMILY, family);

    try {
      await next();
    } finally {
      // The fallback serves an unregistered date with the effective version's
      // stack: the header names the namespace that was asked for.
      const answered = (context.get(VERSION_REQUEST) as string | undefined) ?? version;
      context.header("X-API-Version", answered);
      context.header("X-API-Version-Status", status);
    }
  };
}

/**
 * One validator per declared source. hono-openapi's validator carries the
 * OpenAPI metadata the document is generated from, so an undocumented mount
 * keeps the validation and drops the metadata: validation is not documentation.
 */
function validators({
  route,
  documented,
  paramSource,
}: {
  route: RestTransportRoute<unknown>;
  documented: boolean;
  paramSource: "route" | "context";
}): MiddlewareHandler[] {
  const stack: MiddlewareHandler[] = [];

  const add = (target: "param" | "query" | "json", schema: z.ZodType | undefined): void => {
    if (!schema) return;

    const middleware = openApiValidator(target, schema, (result) => {
      // The typed refusal, raised here rather than left for a boundary to
      // recognise: a family with an `onError` of its own must not answer 500
      // for a request every other family answers 422 for.
      if (!result.success) {
        throw requestValidationErrorFrom({ target, error: result.error, input: result.data });
      }
    });

    if (!documented) {
      delete (middleware as Partial<Record<typeof uniqueSymbol, unknown>>)[uniqueSymbol];
    }

    stack.push(middleware);
  };

  if (route.params && paramSource === "context") {
    // The date fallback matched the path itself, so Hono's route params belong
    // to the guard rather than to the endpoint.
    const schema = route.params;

    stack.push(async (context, next) => {
      const named = (context.get(ROUTE_PARAMS) as Record<string, string> | undefined) ?? {};
      const parsed = schema.safeParse(named);

      if (!parsed.success) {
        throw requestValidationErrorFrom({ target: "param", error: parsed.error, input: named });
      }

      context.set("params", parsed.data);
      await next();
    });
  } else {
    add("param", route.params);
  }

  add("query", route.query);
  add("json", route.input);

  return stack;
}

/** The one validated handler input: path, query and body fields, flattened. */
function inputMiddleware({
  route,
  paramSource,
}: {
  route: RestTransportRoute<unknown>;
  paramSource: "route" | "context";
}): MiddlewareHandler {
  return async (context, next) => {
    const matched =
      paramSource === "route" ? context.req.valid("param" as never) : context.get("params");

    const params = route.params ? matched : undefined;

    const query = route.query ? context.req.valid("query" as never) : undefined;
    const body = route.input ? context.req.valid("json" as never) : undefined;

    context.set(ROUTE_INPUT, mergeInput({ params, query, body }));
    await next();
  };
}

function mergeInput({
  params,
  query,
  body,
}: {
  params: unknown;
  query: unknown;
  body: unknown;
}): Record<string, unknown> | undefined {
  if (params === undefined && query === undefined && body === undefined) return undefined;

  const input: Record<string, unknown> = {};

  for (const [source, part] of [
    ["path", params],
    ["query", query],
    ["body", body],
  ] as const) {
    if (part === undefined) continue;

    if (part === null || typeof part !== "object" || Array.isArray(part)) {
      throw new TypeError(`REST ${source} schemas must produce an object`);
    }

    for (const [key, value] of Object.entries(part)) {
      if (Object.hasOwn(input, key)) {
        throw new TypeError(`REST input field "${key}" is declared by multiple sources`);
      }

      input[key] = value;
    }
  }

  return input;
}

/** Authenticate, decide, handle, check the answer, respond. */
function handlerMiddleware<Api>({
  route,
  credential,
  ports,
  options,
  facts,
}: {
  route: RestTransportRoute<Api>;
  credential: RestDoorCredential;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
}): MiddlewareHandler {
  return async (context) => {
    const input = context.get(ROUTE_INPUT);

    // A public route resolves nothing: no credential is read, no scope is
    // established, and the handler is told so rather than handed a guess.
    if (route.access) {
      const result = await route.handler(
        { app: options.app(), input, actor: null, scope: null, signal: context.req.raw.signal },
        ...(await resolveFacts({ route, facts, context })),
      );

      return respond({ context, route, result });
    }

    const permission = permissionOf(route.permission);

    const caller = await ports.identity.authenticate({
      request: context.req.raw,
      permission,
    });

    const decision = await decide({
      declaration: {
        kind: "service-authorized",
        reason: options.reason ?? HOST_ENFORCED,
        permissions: [permission],
      },
      caller: { actor: normalizedActor(caller.actor), scope: caller.scope },
      input,
      ...(ports.authorization
        ? { authorize: ports.authorization.forRequest(context.req.raw) }
        : {}),
      ...(ports.denials ? { denials: ports.denials } : {}),
    });

    const result = await route.handler(
      {
        app: options.app(),
        input,
        actor: decision.actor,
        scope: doorScopeOf({ credential, scope: caller.scope }),
        signal: context.req.raw.signal,
      },
      ...(await resolveFacts({ route, facts, context })),
    );

    caller.markUsed?.();

    return respond({ context, route, result });
  };
}

/**
 * The declared facts, in declaration order, each parsed by the schema that
 * declared it. Resolved after the access decision, so a refused request never
 * asks the process for anything.
 */
async function resolveFacts({
  route,
  facts,
  context,
}: {
  route: RestTransportRoute<unknown>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
  context: Context;
}): Promise<unknown[]> {
  const resolved: unknown[] = [];

  for (const fact of route.middleware ?? []) {
    const binding = facts.get(fact.name);

    if (!binding) {
      throw new Error(`REST ${route.operation} declares the fact "${fact.name}" and none is bound`);
    }

    resolved.push(fact.schema.parse(await binding.resolve(context)));
  }

  return resolved;
}

function normalizedActor(actor: Actor | null): (Actor & { id: string }) | null {
  if (!actor) return null;

  const parsed = actorSchema.parse(actor);

  return "id" in parsed && typeof parsed.id === "string"
    ? (parsed as Actor & { id: string })
    : null;
}

/**
 * The scope the declaration's door promised, or a refusal naming both tiers.
 *
 * A plain `Error`: a door that resolved another tier is mis-wired, and no
 * caller can act on it. The credential-class refusal a CALLER earns — a
 * project key at an organization family — is the door's own, thrown before
 * this is ever reached.
 */
function doorScopeOf({
  credential,
  scope,
}: {
  credential: RestDoorCredential;
  scope: AuthzDeclaredScopeId;
}) {
  const tier = DOOR_SCOPE_TIER[credential];

  if (scope.tier !== tier) {
    throw new Error(
      `REST transport authorization established a "${scope.tier}" scope for a "${credential}" ` +
        `door, which resolves a "${tier}" scope`,
    );
  }

  return scope;
}

/**
 * The declared answer. The success status is fixed at declaration rather than
 * read off what the handler returned, so one operation cannot answer 200 on
 * the request that found something and 204 on the one that did not.
 */
function respond({
  context,
  route,
  result,
}: {
  context: Context;
  route: RestTransportRoute<unknown>;
  result: unknown;
}): Response {
  const validation = route.output.safeParse(result);

  if (!validation.success) {
    outputLogger.error(
      {
        endpoint: context.get(ENDPOINT_ROUTE) ?? "<unregistered>",
        method: context.req.method,
        path: context.req.path,
        validation: validationMeta(validation.error, { privacy: "schema-only" }),
      },
      "REST handler response did not match its declared output schema",
    );

    return context.json(result as never, route.status ?? 200);
  }

  // Reachable only for a `z.void()` output: a route that declared no answer
  // always takes this branch, and every other route never does.
  if (validation.data === undefined) return context.body(null, route.status ?? 204);

  return context.json(validation.data as never, route.status ?? 200);
}

/**
 * The version namespace: any real date the caller pins dispatches to the
 * latest registration on or before it, and anything else that is not a
 * servable version answers 404 rather than falling through to a dynamic route.
 */
function mountVersionGuards<Api>({
  app,
  basePath,
  declaration,
  ports,
  options,
  facts,
}: {
  app: Hono;
  basePath: string;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
}): void {
  const namespace = "/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
  const fallback = dateFallback({ basePath, declaration, ports, options, facts });
  const notFound: MiddlewareHandler = async (context) => context.notFound();

  for (const guard of [namespace, `${namespace}/*`]) {
    const handlers: [MiddlewareHandler, ...MiddlewareHandler[]] = [fallback, notFound];
    const absolute = mergePath(basePath, guard);
    const alias = canonicalV1Path(absolute);

    app.all(absolute, ...handlers);
    if (alias) app.all(alias, ...handlers);

    registerRoutePolicy({
      method: "all",
      path: absolute,
      ...(alias ? { canonicalPath: alias } : {}),
      policy: publicEndpoint(
        "version-namespace guard: answers 404 for unknown version segments " +
          "so they cannot fall through to a dynamic route; " +
          "reads no data and takes no credential",
      ),
      family: declaration.namespace,
      credentialClass: "none",
      isNamespaceGuard: true,
    });
  }
}

/** Serves an unregistered but real date with the effective version's stack. */
function dateFallback<Api>({
  basePath,
  declaration,
  ports,
  options,
  facts,
}: {
  basePath: string;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
}): MiddlewareHandler {
  const candidates = declaration.routes.map((route) => ({
    method: route.method,
    pattern: route.path || "/",
    stack: routeStack({
      route,
      declaration,
      ports,
      options,
      facts,
      version: declaration.version,
      status: "stable",
      paramSource: "context",
      documented: false,
    }),
  }));

  return async (context, next) => {
    const requested = context.req.param("apiVersion") ?? "";

    if (!isDateVersion(requested) || requested < declaration.version) return next();

    // The guard is mounted under both prefixes, so the base to strip comes
    // from the route that matched rather than from the family's bare path.
    const marker = context.req.routePath.indexOf("/:apiVersion");
    const mountBase = marker >= 0 ? context.req.routePath.slice(0, marker) : basePath;
    const rest = context.req.path.slice(mountBase.length + requested.length + 1) || "/";
    const method = context.req.method.toLowerCase();

    for (const candidate of candidates) {
      if (candidate.method !== method) continue;

      const params = matchPath(candidate.pattern, rest);

      if (!params) continue;

      context.set(ROUTE_PARAMS, params);
      context.set(VERSION_REQUEST, requested);

      const response = await runStack(candidate.stack, context);

      return response ?? next();
    }

    return next();
  };
}

/**
 * Runs a mount's own stack outside Hono's router, for the date fallback, and
 * preserves short-circuiting. Assigning each response to the context mirrors
 * Hono and keeps headers written by an outer `finally` on the answer.
 */
async function runStack(
  stack: readonly MiddlewareHandler[],
  context: Context,
): Promise<Response | undefined> {
  let index = 0;

  const dispatch = async (): Promise<Response | undefined> => {
    const handler = stack[index++];

    if (!handler) return undefined;

    let inner: Response | undefined;

    const returned = await handler(context, async () => {
      inner = await dispatch();
    });

    const response = returned instanceof Response ? returned : inner;

    if (response) context.res = response;

    return response;
  };

  return dispatch();
}

/**
 * Matches a declared path against the request's remainder, extracting
 * `:params`. Literal segments and `:name` are all a declared route can carry.
 */
function matchPath(pattern: string, path: string): Record<string, string> | null {
  const expected = segmentsOf(pattern);
  const actual = segmentsOf(path);
  const params: Record<string, string> = {};

  if (expected.length !== actual.length) return null;

  for (const [index, segment] of expected.entries()) {
    const value = actual[index]!;

    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeSegment(value);
      continue;
    }

    if (segment !== value) return null;
  }

  return params;
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function decodeSegment(value: string): string {
  if (!value.includes("%")) return value;

  try {
    return decodeURIComponent(value);
  } catch {
    // Hono still decodes each valid percent run when another is malformed, so
    // the eager and fallback route params stay byte-for-byte equal.
    return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    });
  }
}

/**
 * One logical route at two addresses: its own, and the canonical `/api/v1`
 * twin, whose stack carries no document metadata so the operation is published
 * once.
 */
function mountRoute({
  app,
  basePath,
  method,
  path,
  stack,
  policy,
  credentialClass,
  family,
}: {
  app: Hono;
  basePath: string;
  method: HttpMethod;
  path: string;
  stack: MiddlewareHandler[];
  policy: AccessPolicy;
  credentialClass: CredentialClass;
  family: string;
}): void {
  const absolute = mergePath(basePath, path);
  const alias = canonicalV1Path(absolute);

  register({ app, method, path: absolute, stack });
  if (alias) register({ app, method, path: alias, stack: undescribedStack(stack) });

  registerRoutePolicy({
    method,
    path: absolute,
    ...(alias ? { canonicalPath: alias } : {}),
    policy,
    family,
    credentialClass,
  });
}

function register({
  app,
  method,
  path,
  stack,
}: {
  app: Hono;
  method: HttpMethod;
  path: string;
  stack: MiddlewareHandler[];
}): void {
  const handlers = stack as [MiddlewareHandler, ...MiddlewareHandler[]];

  // Hono exposes no `.head` shortcut, and HEAD is answered from the GET route
  // before routing, so that registration is for the registry and the document.
  if (method === "head") app.on("HEAD", path, ...handlers);
  else app[method](path, ...handlers);
}

const HANDLER_CREDENTIAL = {
  projectKey: "apiKey",
  organizationKey: "apiKey",
  session: "session",
  internalSecret: "internal",
} as const satisfies Record<Exclude<Credential, "public">, HandlerCredential>;

/** Which security scheme a consumer of each credential presents. */
const CREDENTIAL_CLASS = {
  projectKey: "project_api_key",
  organizationKey: "organization_api_key",
  session: "session",
  internalSecret: "internal",
  public: "none",
} as const satisfies Record<Credential, CredentialClass>;

/**
 * What the route registry records: the door authenticates and enforces, so the
 * route is handler-managed, and the credential the mount named is what an API
 * consumer presents.
 */
function registryPolicy<Api>({
  route,
  options,
  credential,
}: {
  route: RestTransportRoute<Api>;
  options: RestMountOptions<Api>;
  credential: Credential;
}): AccessPolicy {
  const reason = options.reason ?? HOST_ENFORCED;

  if (route.access) return publicEndpoint(route.access.reason);

  if (credential === "public") return publicEndpoint(reason);

  return handlerManagedAuth({
    reason,
    credential: HANDLER_CREDENTIAL[credential],
    permissions: [permissionOf(route.permission)],
  });
}

/**
 * Which credential an API consumer presents at this mount. The declaration
 * names its door; the mount may only widen to a class no door resolves yet,
 * and a mount naming the OTHER door is refused here rather than serving an
 * organization family behind a project key.
 */
function mountCredential<Api>({
  declaration,
  options,
}: {
  declaration: RestTransportDeclaration<Api>;
  options: RestMountOptions<Api>;
}): Credential {
  const named = options.credential;

  if (named === void 0) return declaration.credential;

  if (named in DOOR_SCOPE_TIER && named !== declaration.credential) {
    throw new Error(
      `REST "${declaration.namespace}" declares the "${declaration.credential}" door and this ` +
        `mount names "${named}"; the declaration is what types its handlers' scope`,
    );
  }

  return named;
}
