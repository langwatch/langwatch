import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ApiSchema } from "./schema.js";

import {
  ChainBuilder,
  type DefaultsChain,
  type InputDeclared,
  type OutputDeclared,
  type ParamsDeclared,
  type RestEndpoint,
  type RestEndpointHandler,
  type RestEndpointDocs,
  type RouteChain,
  type RpcChain,
  type SseChain,
  assertRouteDef,
  assertRoutePath,
  assertPublicRestDef,
  assertRpcDef,
  assertSseDef,
  assertStatusInvariant,
  collectDef,
  mergeDefs,
} from "./definition.js";
import { createErrorHandler } from "./errors.js";
import { loggerMiddleware, tracerMiddleware } from "./middleware.js";
import { type RpcName, assertRpcName } from "./rpc-name.js";
import { mountResolvedRoutes } from "./route-mounting.js";
import type { TypedSSEStream } from "./sse.js";
import type {
  BaseApp,
  DateVersion,
  EndpointDocs,
  EndpointVariables,
  HttpMethod,
  RawEndpointDef,
  RestServiceConfig,
  ServiceConfig,
  ServiceContext,
  VersionLabel,
} from "./types.js";
import { API_VERSION_HEADER, assertVersionLabel, VERSION_PREVIEW } from "./types.js";
import { type RegistrationEvent, resolveVersions } from "./versioning.js";

// ---------------------------------------------------------------------------
// Handler shapes
//
// The handler signature is positional: `(c, input)` — the Hono context and the
// validated input. REST path, query and body fields are normalized into that
// argument. Provided services remain typed context variables; SSE query stays
// on context because the stream is its second argument.
//
// A note on typing honesty: `input` is declared on the definition chain, which
// is the argument AFTER the handler — and TypeScript checks arguments in
// order, so the chain cannot flow back into the handler's parameter type (the
// compiler checks the handler body before it infers from `define`). Annotate
// the handler parameter (or delegate to a typed domain function) for a typed
// `input`; the declared schema is always the runtime guarantee. An endpoint
// registered without a chain gets `input: undefined` — that one IS enforced by
// the no-chain overloads below.
// ---------------------------------------------------------------------------

/**
 * Contextual handler shape. The inferred `THandler` retains whether the author
 * actually declared the second parameter and what the handler returns; the
 * broad constraint exists only to type the inline callback parameters.
 */
type RpcHandler<TVariables extends Record<string, unknown>, TApp> = (
  c: ServiceContext<TVariables, TApp>,
  // oxlint-disable-next-line typescript/no-explicit-any -- the annotated handler parameter is the domain type; this constraint only supplies contextual typing.
  input: any,
  // oxlint-disable-next-line typescript/no-explicit-any -- inferred from each concrete handler.
) => any;

type RouteHandler<TVariables extends Record<string, unknown>, TApp> = RpcHandler<TVariables, TApp>;

type NeedsOutput<TResult> = [Awaited<TResult>] extends [Response | void] ? false : true;
type HasInput<THandler extends (...args: never[]) => unknown> =
  "1" extends keyof Parameters<THandler> ? true : false;
type RequiredDefinition<TChain, TNeedsInput extends boolean, TResult> = TChain &
  (TNeedsInput extends true ? InputDeclared : unknown) &
  (NeedsOutput<TResult> extends true ? OutputDeclared : unknown);

type RouteChainFor<TMethod extends HttpMethod> = TMethod extends "get"
  ? RouteChain & { readonly withInput: never }
  : RouteChain;
type PathNeedsParams<TPath extends string> = TPath extends `${string}:${string}` ? true : false;
type CompleteRouteDefinition<
  TChain,
  TNeedsInput extends boolean,
  TNeedsParams extends boolean,
> = TChain &
  (TNeedsInput extends true ? InputDeclared : unknown) &
  (TNeedsParams extends true ? ParamsDeclared : unknown) &
  OutputDeclared;

/** SSE handler: `(c, stream)` — a stream has no body. */
type SseHandler<TVariables extends Record<string, unknown>, TApp> = (
  c: ServiceContext<TVariables, TApp>,
  stream: TypedSSEStream<Record<string, ApiSchema>>,
) => void | Promise<void>;

/** Handler of an endpoint registered with no definition chain at all. */
type BareHandler<TVariables extends Record<string, unknown>, TApp> = (
  c: ServiceContext<TVariables, TApp>,
  input: undefined,
) => Response | Promise<Response>;

/**
 * Fluent builder for constructing a versioned Hono service.
 *
 * @typeParam TProject - The project type provider factories see as `base.project`.
 * @typeParam TVariables - The context variable map: `EndpointVariables` widened
 *   by each `.provide()` call, so `c.get("things")` is typed in every handler.
 */
class ServiceBuilder<TProject, TVariables extends Record<string, unknown>, TApp = unknown> {
  private readonly _config: ServiceConfig<TApp>;
  private readonly _providers: Record<
    string,
    (base: BaseApp<TProject>, context: Context) => unknown
  >;
  private readonly _events: RegistrationEvent[];
  private readonly _defaults: ChainBuilder;

  constructor(
    config: ServiceConfig<TApp>,
    providers: Record<string, (base: BaseApp<TProject>, context: Context) => unknown> = {},
    events: RegistrationEvent[] = [],
    defaults: ChainBuilder = new ChainBuilder(),
  ) {
    if (!config.name.trim()) {
      throw new Error("Service name must not be empty");
    }
    this._config = config;
    this._providers = providers;
    this._events = events;
    this._defaults = defaults;
  }

  /**
   * Register provider factories that resolve concurrently for each request.
   * Factories receive the base app context and cannot depend on one another.
   * Provided services reach handlers as typed context variables.
   */
  provide<P extends Record<string, (base: BaseApp<TProject>, context: Context) => unknown>>(
    providers: P,
  ): ServiceBuilder<TProject, TVariables & { [K in keyof P]: Awaited<ReturnType<P[K]>> }, TApp> {
    for (const key of Object.keys(providers)) {
      if (key === "project" || key === "_legacy") {
        throw new Error(`Provider name "${key}" is reserved by BaseApp`);
      }
      if (key === "params" || key === "query") {
        throw new Error(`Provider name "${key}" is reserved for validated request data`);
      }
    }

    return new ServiceBuilder<
      TProject,
      TVariables & { [K in keyof P]: Awaited<ReturnType<P[K]>> },
      TApp
    >(this._config, { ...this._providers, ...providers }, [...this._events], this._defaults);
  }

  // -- service-level defaults (ADR 001 §4) -----------------------------------
  //
  // A `.withX()` on the service builder is the default for every endpoint.
  // Endpoint-level re-declaration wins; `withMiddleware` stacks (service
  // middleware runs first); `withAuth` keeps its override semantics including
  // `"none"`; `withCache` / `withRateLimit` have per-endpoint opt-outs.

  withDocs(docs: EndpointDocs): this {
    this._defaults.withDocs(docs);
    return this;
  }

  withAuth(auth: "default" | "none" | MiddlewareHandler): this {
    this._defaults.withAuth(auth);
    return this;
  }

  withPermission(permission: Parameters<DefaultsChain["withPermission"]>[0]): this {
    this._defaults.withPermission(permission);
    return this;
  }

  withoutPermission(reason: string): this {
    this._defaults.withoutPermission(reason);
    return this;
  }

  withResourceLimit(limitType: string): this {
    this._defaults.withResourceLimit(limitType);
    return this;
  }

  withoutResourceLimit(reason: string): this {
    this._defaults.withoutResourceLimit(reason);
    return this;
  }

  withMiddleware(...middleware: MiddlewareHandler[]): this {
    this._defaults.withMiddleware(...middleware);
    return this;
  }

  withMeta(meta: unknown): this {
    this._defaults.withMeta(meta);
    return this;
  }

  withRateLimit(): this {
    this._defaults.withRateLimit();
    return this;
  }

  withoutRateLimit(reason: string): this {
    this._defaults.withoutRateLimit(reason);
    return this;
  }

  withCache(tag: string, ttlSeconds: number): this {
    this._defaults.withCache(tag, ttlSeconds);
    return this;
  }

  withDeprecated(notice: string): this {
    this._defaults.withDeprecated(notice);
    return this;
  }

  // -- registration -----------------------------------------------------------

  /**
   * Register an RPC endpoint: a dotted lower-camelCase name, mounted as a POST
   * at `/api/{service}/{version}/{name}`. Every argument travels in the JSON
   * body. An endpoint with no required arguments declares no `withInput`, and
   * a bodyless POST and a `{}` POST both succeed.
   */
  register<TName extends string>(
    name: TName & RpcName<TName>,
    version: VersionLabel,
    handler: BareHandler<TVariables, TApp>,
  ): this;
  register<TName extends string, THandler extends RpcHandler<TVariables, TApp>>(
    name: TName & RpcName<TName>,
    version: VersionLabel,
    handler: THandler,
    define: (b: RpcChain) => RequiredDefinition<RpcChain, HasInput<THandler>, ReturnType<THandler>>,
  ): this;
  register(
    name: string,
    version: string,
    handler: unknown,
    define?: (b: ChainBuilder) => unknown,
  ): this {
    this._registerRpc(name, version, undefined, handler, define);
    return this;
  }

  /**
   * Register an SSE endpoint: a dotted name mounted as a GET. The handler
   * takes `(c, stream)`; request data arrives through `withQuery` only.
   */
  registerSse<TName extends string>(
    name: TName & RpcName<TName>,
    version: VersionLabel,
    handler: SseHandler<TVariables, TApp>,
    define?: (b: SseChain) => SseChain,
  ): this {
    this._registerSse(name, version, undefined, handler, define);
    return this;
  }

  /**
   * Register an HTTP endpoint with an explicit REST method and path.
   */
  registerRoute<
    TMethod extends HttpMethod,
    TPath extends string,
    THandler extends RouteHandler<TVariables, TApp>,
  >(
    method: TMethod,
    path: TPath,
    version: VersionLabel,
    handler: THandler,
    define: (
      b: RouteChainFor<TMethod>,
    ) => CompleteRouteDefinition<
      RouteChainFor<TMethod>,
      HasInput<THandler>,
      PathNeedsParams<TPath>
    >,
  ): this;
  registerRoute(
    method: HttpMethod,
    path: string,
    version: string,
    handler: unknown,
    define?: (b: ChainBuilder) => unknown,
  ): this {
    this._registerRoute(method, path, version, undefined, handler, define);
    return this;
  }

  /**
   * A registrar sharing a chain across endpoints (ADR 001 §5). Dotted names
   * registered through the group are prefixed with the group's name and
   * grammar-checked on the full name; `registerRoute` paths are used as-is.
   * Groups do not nest and carry no version.
   */
  group(
    name: string,
    define?: (b: DefaultsChain) => DefaultsChain,
  ): GroupRegistrar<TVariables, TApp> {
    return new GroupRegistrar<TVariables, TApp>(this, name, collectDef(define));
  }

  /**
   * Withdraw an endpoint: 410 Gone from `version` onward, on every mount, with
   * the withdrawn endpoint's config still on the mount report. Names a dotted
   * RPC/SSE name or a REST route path.
   */
  withdraw(name: string, version: VersionLabel): this {
    this._withdraw(name, version);
    return this;
  }

  /** Withdraw an HTTP route without changing the method callers use to reach it. */
  withdrawRoute(method: HttpMethod, path: string, version: VersionLabel): this {
    this._withdrawRoute(method, path, version);
    return this;
  }

  /** Build the final Hono application and mount every resolved route. */
  build(): Hono {
    this._validateConfiguration();

    const basePath = this._config.basePath ?? `/api/${this._config.name}`;
    if (!basePath.startsWith("/")) {
      throw new Error(`Service basePath must start with "/"; received "${basePath}"`);
    }

    const app = new Hono().basePath(basePath);
    if (this._config.tracer !== false) {
      app.use("*", tracerMiddleware({ name: this._config.name }));
    }
    if (this._config.logger !== false) {
      app.use("*", loggerMiddleware({ name: this._config.name }));
    }
    for (const middleware of this._config.middleware ?? []) {
      app.use("*", middleware);
    }

    const onError = this._config.onError ?? createErrorHandler();
    mountResolvedRoutes({
      app,
      basePath,
      onError,
      providers: this._providers,
      serviceConfig: this._config,
      versionMap: resolveVersions(this._events),
    });
    app.onError(onError);
    return app;
  }

  // -- internal registration (shared with GroupRegistrar) ---------------------

  /** @internal */
  _registerRpc(
    name: string,
    version: string,
    groupDefaults: RawEndpointDef | undefined,
    handler: unknown,
    define: ((b: ChainBuilder) => unknown) | undefined,
  ): void {
    assertVersionLabel(version);
    assertRpcName(name);
    const def = collectDef(define);
    assertRpcDef({ name, def });
    const config = mergeDefs(this._defaults._def, groupDefaults ?? {}, def);
    assertStatusInvariant({ method: "post", path: `/${name}`, def: config });
    this._events.push({
      version,
      endpoint: {
        kind: "rpc",
        method: "post",
        path: `/${name}`,
        config,
        handler: handler as (...args: unknown[]) => unknown,
      },
    });
  }

  /** @internal */
  _registerSse(
    name: string,
    version: string,
    groupDefaults: RawEndpointDef | undefined,
    handler: unknown,
    define: ((b: ChainBuilder) => unknown) | undefined,
  ): void {
    assertVersionLabel(version);
    assertRpcName(name);
    const def = collectDef(define);
    assertSseDef({ name, def });
    const config = mergeDefs(this._defaults._def, groupDefaults ?? {}, def);
    this._events.push({
      version,
      endpoint: {
        kind: "sse",
        method: "sse",
        path: `/${name}`,
        config,
        handler: handler as (...args: unknown[]) => unknown,
      },
    });
  }

  /** @internal */
  _registerRoute(
    method: HttpMethod,
    path: string,
    version: string,
    groupDefaults: RawEndpointDef | undefined,
    handler: unknown,
    define: ((b: ChainBuilder) => unknown) | undefined,
  ): void {
    assertVersionLabel(version);
    assertRoutePath(path);
    const def = collectDef(define);
    const config = mergeDefs(this._defaults._def, groupDefaults ?? {}, def);
    assertRouteDef({ method, path, def: config });
    assertStatusInvariant({ method, path, def: config });
    this._events.push({
      version,
      endpoint: {
        kind: "rest",
        method,
        path,
        config,
        handler: handler as (...args: unknown[]) => unknown,
      },
    });
  }

  /** @internal */
  _registerPublicRest(
    method: HttpMethod,
    path: string,
    version: string,
    handler: unknown,
    definition: RawEndpointDef,
  ): void {
    if (!this._config.publicRest) {
      throw new Error(`The fluent ${method.toUpperCase()} API belongs to createRestService()`);
    }
    assertVersionLabel(version);
    if (version === VERSION_PREVIEW) {
      throw new Error("Public REST registrations use dated versions, not preview");
    }
    assertRoutePath(path);
    const config = mergeDefs(this._defaults._def, definition);
    if (config.docs?.security !== void 0) {
      throw new Error(
        `Public REST endpoint ${method.toUpperCase()} ${path || "/"} cannot declare OpenAPI ` +
          `security; declare it once through createRestService({ openapiSecurity })`,
      );
    }
    if (config.auth !== "none" && this._config.auth && this._config.publicRest?.security) {
      config.docs = { ...config.docs, security: this._config.publicRest.security };
    }
    assertPublicRestDef({ method, path, def: config });
    assertStatusInvariant({ method, path, def: config });
    this._events.push({
      version,
      endpoint: {
        kind: "public-rest",
        method,
        path,
        config,
        handler: handler as (...args: unknown[]) => unknown,
      },
    });
  }

  /** @internal */
  _withdraw(name: string, version: string): void {
    assertVersionLabel(version);
    const path = name.startsWith("/") ? name : `/${name}`;
    const matches = this._events.filter(
      ({ endpoint }) => !endpoint.withdrawn && endpoint.path === path,
    );
    const methods = new Set(matches.map(({ endpoint }) => endpoint.method));
    if (methods.size !== 1) {
      throw new Error(
        `Cannot infer one method for withdrawn endpoint "${path}"; use withdrawRoute(method, path, version)`,
      );
    }
    const method = [...methods][0]!;
    const prior = matches.at(-1)!.endpoint;
    this._events.push({
      version,
      endpoint: {
        kind: prior.kind,
        method,
        path,
        config: {},
        // biome-ignore lint/suspicious/noEmptyBlockStatements: a withdrawn endpoint's handler is never invoked; the shape exists to satisfy the record type.
        handler: () => {},
        withdrawn: true,
      },
    });
  }

  /** @internal Withdraw a REST route without changing its HTTP method. */
  _withdrawRoute(method: HttpMethod, path: string, version: string): void {
    assertVersionLabel(version);
    assertRoutePath(path);
    this._events.push({
      version,
      endpoint: {
        kind: "rest",
        method,
        path,
        config: {},
        // biome-ignore lint/suspicious/noEmptyBlockStatements: a withdrawn endpoint's handler is never invoked; the shape exists to satisfy the record type.
        handler: () => {},
        withdrawn: true,
      },
    });
  }

  /** @internal Withdraw a modern REST route with its public route kind intact. */
  _withdrawPublicRestRoute(method: HttpMethod, path: string, version: string): void {
    assertVersionLabel(version);
    if (version === VERSION_PREVIEW) {
      throw new Error("Public REST withdrawals use dated versions, not preview");
    }
    assertRoutePath(path);
    this._events.push({
      version,
      endpoint: {
        kind: "public-rest",
        method,
        path,
        config: {},
        // biome-ignore lint/suspicious/noEmptyBlockStatements: a withdrawn endpoint's handler is never invoked; the shape exists to satisfy the record type.
        handler: () => {},
        withdrawn: true,
      },
    });
  }

  /** @internal Build only when every recorded endpoint belongs to modern REST. */
  _buildPublicRest(): Hono {
    if (this._events.some(({ endpoint }) => endpoint.kind !== "public-rest")) {
      throw new Error(
        "Modern REST cannot build a service containing non-REST endpoint registrations",
      );
    }
    return this.build();
  }

  private _validateConfiguration(): void {
    for (const { endpoint } of this._events) {
      if (endpoint.withdrawn) continue;
      const route = `${(endpoint.method === "sse" ? "get" : endpoint.method).toUpperCase()} ${
        endpoint.path
      }`;
      const { config } = endpoint;
      const optedOut = config.noPermission;
      if (Boolean(config.permission) === Boolean(optedOut)) {
        throw new Error(
          `Endpoint ${route} must declare exactly one of withPermission or ` + `withoutPermission`,
        );
      }
      if (optedOut && optedOut.reason.trim() === "") {
        throw new Error(`Endpoint ${route} opts out of its permission check with a blank reason`);
      }
      if (endpoint.kind === "public-rest") {
        if (config.rateLimit !== true && !config.rateLimitOptOutReason?.trim()) {
          throw new Error(`Public REST endpoint ${route} has no rate-limit decision`);
        }
        if (config.resourceLimit === void 0 && !config.resourceLimitOptOutReason?.trim()) {
          throw new Error(`Public REST endpoint ${route} has no resource-limit decision`);
        }
      }
      if (config.permission && !this._config.permissionEnforcer) {
        throw new Error(
          `Endpoint ${route} declares permission "${config.permission}" but ` +
            `the service has no permissionEnforcer`,
        );
      }
      if (config.resourceLimit && !this._config._legacy?.resourceLimitMiddleware) {
        throw new Error(
          `Endpoint ${route} declares resourceLimit ` +
            `"${config.resourceLimit}" but the service has no resourceLimitMiddleware`,
        );
      }
      if (config.rateLimit && !this._config.rateLimiter) {
        throw new Error(
          `Endpoint ${route} declares withRateLimit but the service has no ` +
            `"rateLimiter" port; pass one to createService({ rateLimiter })`,
        );
      }
      if (config.cache && !this._config.cache) {
        throw new Error(
          `Endpoint ${route} declares withCache but the service has no ` +
            `"cache" port; pass one to createService({ cache })`,
        );
      }
      if (config.cache && !config.output) {
        throw new Error(
          `Endpoint ${route} declares withCache but no "output"; ` +
            `unvalidated bytes may not be cached`,
        );
      }
    }
  }
}

/**
 * The registrar returned by `service.group(name, define?)`: the same
 * registration methods as the service, with the group's chain applied as
 * defaults between the service defaults and the endpoint's own declaration.
 */
class GroupRegistrar<TVariables extends Record<string, unknown>, TApp = unknown> {
  constructor(
    // biome-ignore lint/suspicious/noExplicitAny: the registrar never touches provider factories, so the project type is irrelevant here and `unknown` would be invariant.
    private readonly _service: ServiceBuilder<any, TVariables, TApp>,
    private readonly _name: string,
    private readonly _defaults: RawEndpointDef,
  ) {}

  register(name: string, version: VersionLabel, handler: BareHandler<TVariables, TApp>): void;
  register<THandler extends RpcHandler<TVariables, TApp>>(
    name: string,
    version: VersionLabel,
    handler: THandler,
    define: (b: RpcChain) => RequiredDefinition<RpcChain, HasInput<THandler>, ReturnType<THandler>>,
  ): void;
  register(
    name: string,
    version: string,
    handler: unknown,
    define?: (b: ChainBuilder) => unknown,
  ): void {
    this._service._registerRpc(`${this._name}.${name}`, version, this._defaults, handler, define);
  }

  registerSse(
    name: string,
    version: VersionLabel,
    handler: SseHandler<TVariables, TApp>,
    define?: (b: SseChain) => SseChain,
  ): void {
    this._service._registerSse(`${this._name}.${name}`, version, this._defaults, handler, define);
  }

  registerRoute<
    TMethod extends HttpMethod,
    TPath extends string,
    THandler extends RouteHandler<TVariables, TApp>,
  >(
    method: TMethod,
    path: TPath,
    version: VersionLabel,
    handler: THandler,
    define: (
      b: RouteChainFor<TMethod>,
    ) => CompleteRouteDefinition<
      RouteChainFor<TMethod>,
      HasInput<THandler>,
      PathNeedsParams<TPath>
    >,
  ): void;
  registerRoute(
    method: HttpMethod,
    path: string,
    version: string,
    handler: unknown,
    define?: (b: ChainBuilder) => unknown,
  ): void {
    // REST paths are used as-is: they already carry their shape.
    this._service._registerRoute(method, path, version, this._defaults, handler, define);
  }

  withdraw(name: string, version: VersionLabel): void {
    this._service._withdraw(name.startsWith("/") ? name : `${this._name}.${name}`, version);
  }
}

/**
 * The sealed author-facing surface for modern REST services.
 *
 * It deliberately exposes neither RPC registration nor provider composition:
 * process composition happens before a REST service is handed to a transport.
 * Endpoint schemas come before their handler so TypeScript can derive both
 * handler input and result types from the Zod 4 schemas.
 */
export interface RestService<
  TApp = unknown,
  TPermission extends boolean = false,
  TRateLimit extends boolean = false,
  TResourceLimit extends boolean = false,
> {
  withDocs(docs: RestEndpointDocs): this;
  withAuth(auth: "default" | "none"): this;
  withPermission(
    permission: Parameters<DefaultsChain["withPermission"]>[0],
  ): RestService<TApp, true, TRateLimit, TResourceLimit>;
  withoutPermission(reason: string): RestService<TApp, true, TRateLimit, TResourceLimit>;
  withResourceLimit(limitType: string): RestService<TApp, TPermission, TRateLimit, true>;
  withoutResourceLimit(reason: string): RestService<TApp, TPermission, TRateLimit, true>;
  withRateLimit(): RestService<TApp, TPermission, true, TResourceLimit>;
  withoutRateLimit(reason: string): RestService<TApp, TPermission, true, TResourceLimit>;
  get<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this;
  post<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this;
  put<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this;
  patch<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this;
  delete<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this;
  withdraw(method: HttpMethod, path: string, version: DateVersion): this;
  build(): Hono;
}

/** The module-private implementation behind {@link RestService}. */
class RestEndpointBuilder extends ChainBuilder {
  handler: unknown;

  handle(handler: unknown): this {
    this.handler = handler;
    return this;
  }
}

class RestServiceBuilder<
  TProject,
  TApp = unknown,
  TPermission extends boolean = false,
  TRateLimit extends boolean = false,
  TResourceLimit extends boolean = false,
> implements RestService<TApp, TPermission, TRateLimit, TResourceLimit> {
  constructor(private readonly service: ServiceBuilder<TProject, EndpointVariables, TApp>) {}

  withDocs(docs: RestEndpointDocs): this {
    this.service.withDocs(docs);
    return this;
  }

  withAuth(auth: "default" | "none"): this {
    this.service.withAuth(auth);
    return this;
  }

  withPermission(
    permission: Parameters<DefaultsChain["withPermission"]>[0],
  ): RestServiceBuilder<TProject, TApp, true, TRateLimit, TResourceLimit> {
    this.service.withPermission(permission);
    return this as RestServiceBuilder<TProject, TApp, true, TRateLimit, TResourceLimit>;
  }

  withoutPermission(
    reason: string,
  ): RestServiceBuilder<TProject, TApp, true, TRateLimit, TResourceLimit> {
    this.service.withoutPermission(reason);
    return this as RestServiceBuilder<TProject, TApp, true, TRateLimit, TResourceLimit>;
  }

  withResourceLimit(
    limitType: string,
  ): RestServiceBuilder<TProject, TApp, TPermission, TRateLimit, true> {
    this.service.withResourceLimit(limitType);
    return this as RestServiceBuilder<TProject, TApp, TPermission, TRateLimit, true>;
  }

  withoutResourceLimit(
    reason: string,
  ): RestServiceBuilder<TProject, TApp, TPermission, TRateLimit, true> {
    this.service.withoutResourceLimit(reason);
    return this as RestServiceBuilder<TProject, TApp, TPermission, TRateLimit, true>;
  }

  withRateLimit(): RestServiceBuilder<TProject, TApp, TPermission, true, TResourceLimit> {
    this.service.withRateLimit();
    return this as RestServiceBuilder<TProject, TApp, TPermission, true, TResourceLimit>;
  }

  withoutRateLimit(
    reason: string,
  ): RestServiceBuilder<TProject, TApp, TPermission, true, TResourceLimit> {
    this.service.withoutRateLimit(reason);
    return this as RestServiceBuilder<TProject, TApp, TPermission, true, TResourceLimit>;
  }

  get<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this {
    return this.register("get", path, version, define);
  }

  post<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this {
    return this.register("post", path, version, define);
  }

  put<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this {
    return this.register("put", path, version, define);
  }

  patch<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this {
    return this.register("patch", path, version, define);
  }

  delete<TPath extends string>(
    path: TPath,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this {
    return this.register("delete", path, version, define);
  }

  withdraw(method: HttpMethod, path: string, version: DateVersion): this {
    this.service._withdrawPublicRestRoute(method, path, version);
    return this;
  }

  build(): Hono {
    return this.service._buildPublicRest();
  }

  private register(
    method: HttpMethod,
    path: string,
    version: DateVersion,
    define: (
      endpoint: RestEndpoint<TApp, undefined, undefined, TPermission, TRateLimit, TResourceLimit>,
    ) => RestEndpoint<TApp, z.ZodObject, z.ZodType, true, true, true, true>,
  ): this {
    const endpoint = new RestEndpointBuilder();
    const authoring: RestEndpoint<
      TApp,
      undefined,
      undefined,
      TPermission,
      TRateLimit,
      TResourceLimit
    > = endpoint;
    define(authoring);
    if (!endpoint.handler) {
      throw new Error("Modern REST endpoint definitions must finish with handle(...)");
    }
    this.service._registerPublicRest(method, path, version, endpoint.handler, endpoint._def);
    return this;
  }
}

/** Creates a new typed service builder. */
export function createService<TProject = unknown, TApp = unknown>(
  config: ServiceConfig<TApp>,
): ServiceBuilder<TProject, EndpointVariables, TApp> {
  return new ServiceBuilder(config);
}

/** Creates the additive public REST builder rooted at `/api/v1/{service}`. */
export function createRestService<TApp = unknown>(
  config: RestServiceConfig<TApp>,
): RestService<TApp> {
  if (!/^[a-z][a-z0-9-]*$/.test(config.name)) {
    throw new Error(`REST service name "${config.name}" must be a lower-kebab path segment`);
  }
  if ("onError" in config) {
    throw new Error("Modern REST uses the framework error boundary; do not configure onError");
  }
  if (!Number.isSafeInteger(config.maxInputBytes) || config.maxInputBytes < 1) {
    throw new Error("Modern REST maxInputBytes must be a positive safe integer");
  }
  if (config.basePath !== void 0 && !isSafeRestBasePath(config.basePath)) {
    throw new Error(
      `REST service basePath must be an absolute /api path of static lower-kebab segments; received "${config.basePath}"`,
    );
  }
  if (config.auth && config.openapiSecurity === void 0) {
    throw new Error(
      `REST service "${config.name}" configures auth but no openapiSecurity declaration`,
    );
  }
  if (!config.auth && config.openapiSecurity !== void 0) {
    throw new Error(
      `REST service "${config.name}" declares openapiSecurity but has no auth middleware`,
    );
  }
  if (config.auth && !hasOpenApiSecuritySchemes(config.openapiSecurity)) {
    throw new Error(
      `REST service "${config.name}" must declare at least one nonblank OpenAPI security scheme`,
    );
  }

  const { maxInputBytes, openapiSecurity, staticVersioning, ...serviceConfig } = config;
  const service = new ServiceBuilder<unknown, EndpointVariables, TApp>({
    ...serviceConfig,
    basePath: config.basePath ?? `/api/v1/${config.name}`,
    publicRest: {
      versionHeader: API_VERSION_HEADER,
      maxInputBytes,
      ...(staticVersioning ? { staticVersioning } : {}),
      security: openapiSecurity,
    },
  });
  return new RestServiceBuilder(service);
}

function isSafeRestBasePath(basePath: string): boolean {
  return /^\/api(?:\/[a-z][a-z0-9-]*)+$/.test(basePath);
}

function hasOpenApiSecuritySchemes(security: unknown): boolean {
  const parsed = z
    .array(z.record(z.string().trim().min(1), z.array(z.string())))
    .min(1)
    .safeParse(security);
  return parsed.success && parsed.data.every((requirement) => Object.keys(requirement).length > 0);
}

export { ServiceBuilder, GroupRegistrar };
