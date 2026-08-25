import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { ApiSchema } from "./schema.js";

import {
  ChainBuilder,
  type DefaultsChain,
  type InputDeclared,
  type OutputDeclared,
  type RouteChain,
  type RpcChain,
  type SseChain,
  assertRoutePath,
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
  EndpointDocs,
  EndpointVariables,
  HttpMethod,
  RawEndpointDef,
  ServiceConfig,
  ServiceContext,
  VersionLabel,
} from "./types.js";
import { assertVersionLabel } from "./types.js";
import { type RegistrationEvent, resolveVersions } from "./versioning.js";

// ---------------------------------------------------------------------------
// Handler shapes
//
// The handler signature is positional: `(c, input)` — the Hono context and the
// validated input. Everything else arrives through typed context variables:
// `.provide()` services via `c.get("things")`, validated params and query via
// `c.get("params")` / `c.get("query")`.
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

type RouteHandler<TVariables extends Record<string, unknown>, TApp> = RpcHandler<
  TVariables,
  TApp
>;

type NeedsOutput<TResult> = [Awaited<TResult>] extends [Response | void] ? false : true;
type HasInput<THandler extends (...args: never[]) => unknown> =
  "1" extends keyof Parameters<THandler> ? true : false;
type RequiredDefinition<TChain, TNeedsInput extends boolean, TResult> = TChain &
  (TNeedsInput extends true ? InputDeclared : unknown) &
  (NeedsOutput<TResult> extends true ? OutputDeclared : unknown);

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
class ServiceBuilder<
  TProject,
  TVariables extends Record<string, unknown>,
  TApp = unknown,
> {
  private readonly _config: ServiceConfig<TApp>;
  private readonly _providers: Record<
    string,
    (base: BaseApp<TProject>, context: Context) => unknown
  >;
  private readonly _events: RegistrationEvent[];
  private readonly _defaults: ChainBuilder;

  constructor(
    config: ServiceConfig<TApp>,
    providers: Record<
      string,
      (base: BaseApp<TProject>, context: Context) => unknown
    > = {},
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
  provide<
    P extends Record<string, (base: BaseApp<TProject>, context: Context) => unknown>,
  >(
    providers: P,
  ): ServiceBuilder<
    TProject,
    TVariables & { [K in keyof P]: Awaited<ReturnType<P[K]>> },
    TApp
  > {
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
    >(
      this._config,
      { ...this._providers, ...providers },
      [...this._events],
      this._defaults,
    );
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
    define: (
      b: RpcChain,
    ) => RequiredDefinition<RpcChain, HasInput<THandler>, ReturnType<THandler>>,
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
   * Register a resource-REST endpoint with an explicit method and path, for
   * the existing REST management families. New families use `register`.
   */
  registerRoute(
    method: HttpMethod,
    path: string,
    version: VersionLabel,
    handler: BareHandler<TVariables, TApp>,
  ): this;
  registerRoute<THandler extends RouteHandler<TVariables, TApp>>(
    method: HttpMethod,
    path: string,
    version: VersionLabel,
    handler: THandler,
    define: (
      b: RouteChain,
    ) => RequiredDefinition<RouteChain, HasInput<THandler>, ReturnType<THandler>>,
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
    assertStatusInvariant({ method, path, def: config });
    this._events.push({
      version,
      endpoint: {
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
    this._events.push({
      version,
      endpoint: {
        method: "get",
        path,
        config: {},
        // biome-ignore lint/suspicious/noEmptyBlockStatements: a withdrawn endpoint's handler is never invoked; the shape exists to satisfy the record type.
        handler: () => {},
        withdrawn: true,
      },
    });
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
          `Endpoint ${route} must declare exactly one of withPermission or ` +
            `withoutPermission`,
        );
      }
      if (optedOut && optedOut.reason.trim() === "") {
        throw new Error(
          `Endpoint ${route} opts out of its permission check with a blank reason`,
        );
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

  register(
    name: string,
    version: VersionLabel,
    handler: BareHandler<TVariables, TApp>,
  ): void;
  register<THandler extends RpcHandler<TVariables, TApp>>(
    name: string,
    version: VersionLabel,
    handler: THandler,
    define: (
      b: RpcChain,
    ) => RequiredDefinition<RpcChain, HasInput<THandler>, ReturnType<THandler>>,
  ): void;
  register(
    name: string,
    version: string,
    handler: unknown,
    define?: (b: ChainBuilder) => unknown,
  ): void {
    this._service._registerRpc(
      `${this._name}.${name}`,
      version,
      this._defaults,
      handler,
      define,
    );
  }

  registerSse(
    name: string,
    version: VersionLabel,
    handler: SseHandler<TVariables, TApp>,
    define?: (b: SseChain) => SseChain,
  ): void {
    this._service._registerSse(
      `${this._name}.${name}`,
      version,
      this._defaults,
      handler,
      define,
    );
  }

  registerRoute(
    method: HttpMethod,
    path: string,
    version: VersionLabel,
    handler: BareHandler<TVariables, TApp>,
  ): void;
  registerRoute<THandler extends RouteHandler<TVariables, TApp>>(
    method: HttpMethod,
    path: string,
    version: VersionLabel,
    handler: THandler,
    define: (
      b: RouteChain,
    ) => RequiredDefinition<RouteChain, HasInput<THandler>, ReturnType<THandler>>,
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
    this._service._withdraw(
      name.startsWith("/") ? name : `${this._name}.${name}`,
      version,
    );
  }
}

/** Creates a new typed service builder. */
export function createService<TProject = unknown, TApp = unknown>(
  config: ServiceConfig<TApp>,
): ServiceBuilder<TProject, EndpointVariables, TApp> {
  return new ServiceBuilder(config);
}

export { ServiceBuilder, GroupRegistrar };
