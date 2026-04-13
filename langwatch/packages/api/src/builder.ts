import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import type { ZodType } from "zod";

import { createErrorHandler } from "./errors.js";
import { tracerMiddleware, loggerMiddleware } from "./middleware.js";
import { createSSEResponse, type SSEConfig, type SSEHandler } from "./sse.js";
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
  sse<TEvents extends Record<string, ZodType>, TConfig extends SSEConfig<TEvents>>(
    path: string,
    config: TConfig,
    handler: SSEHandler<TApp, TEvents, TConfig>,
  ): void {
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
  private readonly _providers: Record<string, (base: BaseApp<TProject>) => unknown>;
  private readonly _versions: VersionDefinition[] = [];
  private readonly _previewEndpoints: EndpointRegistration[] = [];

  constructor(
    config: ServiceConfig,
    providers: Record<string, (base: BaseApp<TProject>) => unknown> = {},
  ) {
    this._config = config;
    this._providers = providers;
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
  ): ServiceBuilder<TProject, TProviders & { [K in keyof P]: Awaited<ReturnType<P[K]>> }> {
    return new ServiceBuilder<TProject, TProviders & { [K in keyof P]: Awaited<ReturnType<P[K]>> }>(
      this._config,
      { ...this._providers, ...providers },
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
  preview(define: (v: VersionBuilder<BaseApp<TProject> & TProviders>) => void): this {
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
    const basePath = this._config.basePath ?? `/api/${this._config.name}`;
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

      // Withdrawn endpoint -- return 410 Gone
      if (ep.withdrawn) {
        const method = ep.method === "sse" ? "get" : ep.method;
        app[method](fullPath, (c) => {
          return c.json(
            { kind: "endpoint_withdrawn", message: "This endpoint has been removed" },
            410,
          );
        });
        continue;
      }

      // Active endpoint -- build middleware stack
      const middlewareStack = this._buildMiddlewareStack({ ep, isVersioned, status, version });
      const method = ep.method === "sse" ? "get" : ep.method;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app[method] as any)(fullPath, ...middlewareStack);
    }
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
    stack.push(async (c, next) => {
      c.set("isVersionedRequest", isVersioned);
      if (version) {
        c.set("apiVersion", version);
      }
      await next();
      // Set response headers
      if (version) {
        c.header("X-API-Version", version);
      }
      c.header("X-API-Version-Status", status);
    });

    // 2. Auth middleware
    const authSetting = config.auth ?? "default";
    if (authSetting === "default" && this._config.auth) {
      stack.push(this._config.auth);
    } else if (typeof authSetting === "function") {
      stack.push(authSetting);
    }
    // "none" -- skip auth

    // 3. Legacy organization middleware
    if (this._config._legacy?.organizationMiddleware) {
      stack.push(this._config._legacy.organizationMiddleware);
    }

    // 4. Legacy resource limit middleware
    if (config.resourceLimit && this._config._legacy?.resourceLimitMiddleware) {
      stack.push(this._config._legacy.resourceLimitMiddleware(config.resourceLimit));
    }

    // 5. Per-endpoint middleware
    if (config.middleware) {
      stack.push(...config.middleware);
    }

    // 6. OpenAPI description (describeRoute) -- only when output or description exists
    if (config.output || config.description) {
      const responses: Record<string, unknown> = {};
      if (config.output) {
        responses["200"] = {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(config.output),
            },
          },
        };
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
      stack.push(zValidator("param", config.params) as unknown as MiddlewareHandler);
    }
    if (config.query) {
      stack.push(zValidator("query", config.query) as unknown as MiddlewareHandler);
    }
    if (config.input) {
      stack.push(zValidator("json", config.input) as unknown as MiddlewareHandler);
    }

    // 8. App context middleware (resolves providers)
    const providers = this._providers;
    stack.push(async (c, next) => {
      const base: BaseApp = {
        project: c.get("project"),
        _legacy: {
          organization: c.get("organization"),
          prisma: c.get("prisma"),
        },
      };

      // Resolve providers
      const resolved: Record<string, unknown> = {};
      for (const [key, factory] of Object.entries(providers)) {
        resolved[key] = await factory(base);
      }

      const appCtx = { ...base, ...resolved };
      c.set("app", appCtx);
      await next();
    });

    // 9. Handler wrapper
    if (ep.method === "sse") {
      // SSE handler
      const sseConfig = ep.config as unknown as SSEConfig<Record<string, ZodType>>;
      stack.push(async (c) => {
        const appCtx = c.get("app");
        const input = config.input ? c.req.valid("json" as never) : undefined;
        const query = config.query ? c.req.valid("query" as never) : undefined;

        return createSSEResponse(c, sseConfig.events, async (stream) => {
          await ep.handler(c, { input, query, app: appCtx }, stream);
        });
      });
    } else {
      // Regular handler
      stack.push(async (c) => {
        const appCtx = c.get("app");
        const input = config.input ? c.req.valid("json" as never) : undefined;
        const params = config.params ? c.req.valid("param" as never) : undefined;
        const query = config.query ? c.req.valid("query" as never) : undefined;

        const result = await ep.handler(c, { input, params, query, app: appCtx });

        // If handler returns a Response directly, use it
        if (result instanceof Response) {
          return result;
        }

        // void/undefined → 204 No Content
        if (result === undefined || result === null) {
          return c.body(null, config.status ?? 204);
        }

        // Validate output if schema is defined
        const status = config.status ?? 200;
        if (config.output) {
          const validated = config.output.parse(result);
          return c.json(validated, status);
        }

        // No output schema -- return as-is
        return c.json(result, status);
      });
    }

    return stack;
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
