import { updateCurrentContext } from "@langwatch/observability/context";
import { Hono, type MiddlewareHandler } from "hono";
import { describeRoute, type DescribeRouteOptions } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import type { ZodType } from "zod";

import { createErrorHandler } from "./errors.js";
import { tracerMiddleware, loggerMiddleware } from "./middleware.js";
import { createSSEResponse, type SSEConfig, type SSEHandler } from "./sse.js";
import { isDateVersion } from "./types.js";
import type {
  BaseApp,
  EndpointConfig,
  EndpointRegistration,
  Handler,
  HttpMethod,
  ServiceConfig,
  VersionStatus,
} from "./types.js";
import {
  resolveVersions,
  type ResolvedEndpoint,
  type VersionDefinition,
} from "./versioning.js";

// ---------------------------------------------------------------------------
// VersionBuilder -- collects endpoint registrations for a single version
// ---------------------------------------------------------------------------

/**
 * Builder used inside the `.version(date, (v) => { ... })` callback.
 *
 * Provides HTTP method helpers and `withdraw()` for removing inherited
 * endpoints.
 */
class VersionBuilder<TApp> {
  /** @internal */
  readonly _endpoints: EndpointRegistration[] = [];

  /** Register a GET endpoint. */
  get<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("get", path, config, handler);
  }

  /** Register a POST endpoint. */
  post<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("post", path, config, handler);
  }

  /** Register a PUT endpoint. */
  put<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("put", path, config, handler);
  }

  /** Register a DELETE endpoint. */
  delete<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("delete", path, config, handler);
  }

  /** Register a PATCH endpoint. */
  patch<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("patch", path, config, handler);
  }

  /**
   * Register an SSE streaming endpoint.
   *
   * The handler receives a `TypedSSEStream` whose `emit()` validates event
   * data against the declared Zod schemas.
   */
  sse<
    TEvents extends Record<string, ZodType>,
    TConfig extends SSEConfig<TEvents>,
  >(
    path: string,
    config: TConfig,
    handler: SSEHandler<TApp, TEvents, TConfig>,
  ): void {
    assertEndpointPath(path);
    this._endpoints.push({
      method: "sse",
      path,
      config: config as unknown as EndpointConfig,
      handler: handler as EndpointRegistration["handler"],
    });
  }

  /**
   * Withdraw (remove) an endpoint inherited from a previous version.
   *
   * Withdrawn endpoints return `410 Gone` in this and all subsequent versions.
   */
  withdraw(method: HttpMethod, path: string): void {
    assertEndpointPath(path);
    this._endpoints.push({
      method,
      path,
      config: {} as EndpointConfig,
      handler: () => {},
      withdrawn: true,
    });
  }

  private _register(
    method: HttpMethod,
    path: string,
    config: EndpointConfig,
    handler: Handler<TApp, EndpointConfig>,
  ): void {
    assertEndpointPath(path);
    this._endpoints.push({
      method,
      path,
      config,
      handler: handler as EndpointRegistration["handler"],
    });
  }
}

// ---------------------------------------------------------------------------
// ServiceBuilder -- the fluent builder returned by createService()
// ---------------------------------------------------------------------------

/**
 * Fluent builder for constructing a versioned Hono service.
 *
 * @typeParam TProject - The project type for `app.project`.
 * @typeParam TProviders - The inferred provider map from `.provide()` calls.
 */
class ServiceBuilder<TProject, TProviders extends Record<string, unknown>> {
  private readonly _config: ServiceConfig;
  private readonly _providers: Record<
    string,
    (base: BaseApp<TProject>) => unknown
  >;
  private readonly _versions: VersionDefinition[];
  private readonly _previewEndpoints: EndpointRegistration[];

  constructor(
    config: ServiceConfig,
    providers: Record<string, (base: BaseApp<TProject>) => unknown> = {},
    versions: VersionDefinition[] = [],
    previewEndpoints: EndpointRegistration[] = [],
  ) {
    if (!config.name.trim()) {
      throw new Error("Service name must not be empty");
    }
    this._config = config;
    this._providers = providers;
    this._versions = versions;
    this._previewEndpoints = previewEndpoints;
  }

  /**
   * Register provider factories.
   *
   * Each factory receives the base app context (`{ project, _legacy }`)
   * and returns a service instance. Providers are resolved per-request and
   * available on `app.{key}` in handlers.
   *
   * No cross-provider dependencies -- factories only receive the base context.
   */
  provide<P extends Record<string, (base: BaseApp<TProject>) => unknown>>(
    providers: P,
  ): ServiceBuilder<
    TProject,
    TProviders & { [K in keyof P]: Awaited<ReturnType<P[K]>> }
  > {
    for (const key of Object.keys(providers)) {
      if (key === "project" || key === "_legacy") {
        throw new Error(`Provider name "${key}" is reserved by BaseApp`);
      }
    }

    return new ServiceBuilder<
      TProject,
      TProviders & { [K in keyof P]: Awaited<ReturnType<P[K]>> }
    >(
      this._config,
      { ...this._providers, ...providers },
      [...this._versions],
      [...this._previewEndpoints],
    );
  }

  /**
   * Register endpoints for a dated version (e.g. `"2025-03-15"`).
   *
   * Versions are forward-copied: each version inherits the previous version's
   * endpoints, and the callback can override, add, or withdraw endpoints.
   */
  version(
    date: string,
    define: (v: VersionBuilder<BaseApp<TProject> & TProviders>) => void,
  ): this {
    if (!isDateVersion(date)) {
      throw new RangeError(
        `Invalid API version "${date}"; expected a real date in YYYY-MM-DD form`,
      );
    }
    if (this._versions.some((definition) => definition.version === date)) {
      throw new Error(`API version "${date}" is registered more than once`);
    }

    const builder = new VersionBuilder<BaseApp<TProject> & TProviders>();
    define(builder);
    this._versions.push({ version: date, endpoints: builder._endpoints });
    return this;
  }

  /**
   * Register preview-only endpoints.
   *
   * Preview endpoints are accessible at `/preview/...` but are never included
   * in `latest`.
   */
  preview(
    define: (v: VersionBuilder<BaseApp<TProject> & TProviders>) => void,
  ): this {
    const builder = new VersionBuilder<BaseApp<TProject> & TProviders>();
    define(builder);
    this._previewEndpoints.push(...builder._endpoints);
    return this;
  }

  /**
   * Build the final Hono application.
   *
   * Creates sub-routers for each resolved version, mounts them under
   * `/{version}/`, and sets up `latest` + bare-path aliases.
   */
  build(): Hono {
    this._validateConfiguration();

    const basePath = this._config.basePath ?? `/api/${this._config.name}`;
    if (!basePath.startsWith("/")) {
      throw new Error(
        `Service basePath must start with "/"; received "${basePath}"`,
      );
    }
    const app = new Hono().basePath(basePath);

    // Apply built-in tracer + logger middleware (unless explicitly disabled)
    if (this._config.tracer !== false) {
      app.use("*", tracerMiddleware({ name: this._config.name }));
    }
    if (this._config.logger !== false) {
      app.use("*", loggerMiddleware({ name: this._config.name }));
    }

    // Apply additional global middleware
    if (this._config.middleware) {
      for (const mw of this._config.middleware) {
        app.use("*", mw);
      }
    }

    // Resolve versions
    const versionMap = resolveVersions(this._versions, this._previewEndpoints);

    // Mount versioned sub-routers
    for (const [version, endpoints] of versionMap) {
      const status = resolveVersionStatus(version);
      this._mountVersion(app, version, status, endpoints);
    }

    // Keep reserved version-like path prefixes from falling through to a
    // dynamic bare-path endpoint when the requested version/route is absent.
    const versionNamespace =
      "/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
    app.all(versionNamespace, (c) => c.notFound());
    app.all(`${versionNamespace}/*`, (c) => c.notFound());

    // Bare path (no version) = latest
    const latestEndpoints = versionMap.get("latest");
    if (latestEndpoints) {
      this._mountVersion(app, null, "unversioned", latestEndpoints);
    }

    // Error handler
    const onError = this._config.onError ?? createErrorHandler();
    app.onError(onError);

    return app;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _mountVersion(
    app: Hono,
    version: string | null,
    status: VersionStatus,
    endpoints: ResolvedEndpoint[],
  ): void {
    const prefix = version ? `/${version}` : "";
    const isVersioned = status !== "unversioned";

    for (const ep of endpoints) {
      const fullPath = `${prefix}${ep.path || "/"}`;
      const method = ep.method === "sse" ? "get" : ep.method;

      // Withdrawn endpoint -- return 410 Gone
      if (ep.withdrawn) {
        const middlewareStack = this._buildWithdrawnMiddlewareStack({
          ep,
          isVersioned,
          status,
          version,
        });
        this._mountRoute(app, method, fullPath, middlewareStack);
        continue;
      }

      // Active endpoint -- build middleware stack
      const middlewareStack = this._buildMiddlewareStack({
        ep,
        isVersioned,
        status,
        version,
      });
      this._mountRoute(app, method, fullPath, middlewareStack);
    }
  }

  private _mountRoute(
    app: Hono,
    method: HttpMethod,
    path: string,
    stack: MiddlewareHandler[],
  ): void {
    const handlers = stack as [MiddlewareHandler, ...MiddlewareHandler[]];
    switch (method) {
      case "get":
        app.get(path, ...handlers);
        break;
      case "post":
        app.post(path, ...handlers);
        break;
      case "put":
        app.put(path, ...handlers);
        break;
      case "delete":
        app.delete(path, ...handlers);
        break;
      case "patch":
        app.patch(path, ...handlers);
        break;
    }
  }

  private _versionContextMiddleware({
    isVersioned,
    status,
    version,
  }: {
    isVersioned: boolean;
    status: VersionStatus;
    version: string | null;
  }): MiddlewareHandler {
    return async (c, next) => {
      c.set("isVersionedRequest", isVersioned);
      if (version) {
        c.set("apiVersion", version);
      }
      try {
        await next();
      } finally {
        if (version) {
          c.header("X-API-Version", version);
        }
        c.header("X-API-Version-Status", status);
      }
    };
  }

  private _appendAccessMiddleware(
    stack: MiddlewareHandler[],
    config: EndpointConfig,
    { includeResourceLimit }: { includeResourceLimit: boolean },
  ): void {
    const authSetting = config.auth ?? "default";
    if (authSetting === "default" && this._config.auth) {
      stack.push(this._config.auth);
    } else if (typeof authSetting === "function") {
      stack.push(authSetting);
    }

    if (this._config._legacy?.organizationMiddleware) {
      stack.push(this._config._legacy.organizationMiddleware);
    }

    if (includeResourceLimit && config.resourceLimit) {
      stack.push(
        this._config._legacy!.resourceLimitMiddleware!(config.resourceLimit),
      );
    }

    if (config.middleware) {
      stack.push(...config.middleware);
    }
  }

  private _buildWithdrawnMiddlewareStack({
    ep,
    isVersioned,
    status,
    version,
  }: {
    ep: ResolvedEndpoint & { withdrawn: true };
    isVersioned: boolean;
    status: VersionStatus;
    version: string | null;
  }): MiddlewareHandler[] {
    const stack: MiddlewareHandler[] = [
      this._versionContextMiddleware({ isVersioned, status, version }),
    ];
    this._appendAccessMiddleware(stack, ep.config, {
      includeResourceLimit: false,
    });
    stack.push(async (c) =>
      c.json(
        {
          kind: "endpoint_withdrawn",
          message: "This endpoint has been removed",
        },
        410,
      ),
    );
    return stack;
  }

  private _buildMiddlewareStack({
    ep,
    isVersioned,
    status,
    version,
  }: {
    ep: EndpointRegistration;
    isVersioned: boolean;
    status: VersionStatus;
    version: string | null;
  }): MiddlewareHandler[] {
    const stack: MiddlewareHandler[] = [];
    const config = ep.config;

    // 1. Version context middleware
    stack.push(
      this._versionContextMiddleware({ isVersioned, status, version }),
    );

    // 2-5. Auth, legacy organization/resource-limit, endpoint middleware
    this._appendAccessMiddleware(stack, config, { includeResourceLimit: true });

    // 6. OpenAPI description (describeRoute) -- only when output or description exists
    if (config.output || config.description) {
      const successStatus = String(config.status ?? 200);
      const responses: NonNullable<DescribeRouteOptions["responses"]> = {};
      if (config.output) {
        responses[successStatus] = {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(config.output),
            },
          },
        };
      } else {
        responses[successStatus] = { description: "Success" };
      }
      stack.push(
        describeRoute({
          description: config.description,
          responses,
        }) as unknown as MiddlewareHandler,
      );
    }

    // 7. Validation middleware
    if (config.params) {
      stack.push(
        zValidator("param", config.params, (result) => {
          if (!result.success) throw result.error;
        }) as unknown as MiddlewareHandler,
      );
    }
    if (config.query) {
      stack.push(
        zValidator("query", config.query, (result) => {
          if (!result.success) throw result.error;
        }) as unknown as MiddlewareHandler,
      );
    }
    // SSE endpoints are GET-only — skip JSON body validation
    if (config.input && ep.method !== "sse") {
      stack.push(
        zValidator("json", config.input, (result) => {
          if (!result.success) throw result.error;
        }) as unknown as MiddlewareHandler,
      );
    }

    // 8. App context middleware (resolves providers)
    const providers = this._providers;
    stack.push(async (c, next) => {
      const base: BaseApp<TProject> = {
        project: c.get("project"),
        _legacy: {
          organization: c.get("organization"),
          prisma: c.get("prisma"),
        },
      };

      // Auth runs inside loggerMiddleware's AsyncLocalStorage scope. Sync the
      // fields it resolved before providers and handlers emit any log entries.
      updateCurrentContext({
        organizationId: c.get("organization")?.id,
        projectId: c.get("project")?.id,
        userId: c.get("user")?.id,
      });

      // Resolve providers
      const resolved = Object.fromEntries(
        await Promise.all(
          Object.entries(providers).map(async ([key, factory]) => [
            key,
            await factory(base),
          ]),
        ),
      );

      const appCtx = { ...base, ...resolved };
      c.set("app", appCtx);
      await next();
    });

    // 9. Handler wrapper
    if (ep.method === "sse") {
      // SSE handler
      const sseConfig = ep.config as unknown as SSEConfig<
        Record<string, ZodType>
      >;
      stack.push(async (c) => {
        const appCtx = c.get("app");
        const query = config.query ? c.req.valid("query" as never) : undefined;

        return createSSEResponse(c, sseConfig.events, async (stream) => {
          await ep.handler(c, { query, app: appCtx }, stream);
        });
      });
    } else {
      // Regular handler
      stack.push(async (c) => {
        const appCtx = c.get("app");
        const input = config.input ? c.req.valid("json" as never) : undefined;
        const params = config.params
          ? c.req.valid("param" as never)
          : undefined;
        const query = config.query ? c.req.valid("query" as never) : undefined;

        const result = await ep.handler(c, {
          input,
          params,
          query,
          app: appCtx,
        });

        // If handler returns a Response directly, use it
        if (result instanceof Response) {
          return result;
        }

        // Validate output if schema is defined
        const status = config.status ?? 200;
        if (config.output) {
          const validation = config.output.safeParse(result);
          if (!validation.success) {
            throw new Error("Response failed output validation", {
              cause: validation.error,
            });
          }
          if (validation.data === undefined) {
            return c.body(null, config.status ?? 204);
          }
          return c.json(validation.data, status);
        }

        // void/undefined → 204 No Content
        if (result === undefined) {
          return c.body(null, 204);
        }

        // No output schema -- return as-is
        return c.json(result, status);
      });
    }

    return stack;
  }

  private _validateConfiguration(): void {
    const endpoints = [
      ...this._versions.flatMap((definition) => definition.endpoints),
      ...this._previewEndpoints,
    ];
    for (const endpoint of endpoints) {
      if (
        endpoint.config.resourceLimit &&
        !this._config._legacy?.resourceLimitMiddleware
      ) {
        throw new Error(
          `Endpoint ${endpoint.method.toUpperCase()} ${endpoint.path} declares resourceLimit ` +
            `"${endpoint.config.resourceLimit}" but the service has no resourceLimitMiddleware`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Version status resolver
// ---------------------------------------------------------------------------

function resolveVersionStatus(version: string): VersionStatus {
  if (version === "latest") return "latest";
  if (version === "preview") return "preview";
  return "stable";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new service builder.
 *
 * ```ts
 * const app = createService({ name: "scenarios" })
 *   .provide({ scenarioService: () => ScenarioService.create(prisma) })
 *   .version("2025-03-15", (v) => {
 *     v.get("/", { output: listSchema }, async (c, { app }) => { ... });
 *   })
 *   .build();
 * ```
 */
export function createService<TProject = unknown>(
  config: ServiceConfig,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
): ServiceBuilder<TProject, {}> {
  return new ServiceBuilder(config);
}

export { ServiceBuilder, VersionBuilder };

function assertEndpointPath(path: string): void {
  if (path !== "" && !path.startsWith("/")) {
    throw new Error(`Endpoint path must start with "/"; received "${path}"`);
  }
}
