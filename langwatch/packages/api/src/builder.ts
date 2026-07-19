import { Hono } from "hono";

import { createErrorHandler } from "./errors.js";
import { loggerMiddleware, tracerMiddleware } from "./middleware.js";
import { mountResolvedRoutes } from "./route-mounting.js";
import { isDateVersion } from "./types.js";
import type { BaseApp, EndpointRegistration, ServiceConfig } from "./types.js";
import { VersionBuilder } from "./version-builder.js";
import { resolveVersions, type VersionDefinition } from "./versioning.js";

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
   * Register provider factories that resolve concurrently for each request.
   * Factories receive the base app context and cannot depend on one another.
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

  /** Register a dated version whose endpoints inherit from earlier versions. */
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

  /** Register preview-only endpoints that are excluded from `latest`. */
  preview(
    define: (v: VersionBuilder<BaseApp<TProject> & TProviders>) => void,
  ): this {
    const builder = new VersionBuilder<BaseApp<TProject> & TProviders>();
    define(builder);
    this._previewEndpoints.push(...builder._endpoints);
    return this;
  }

  /** Build the final Hono application and mount every resolved route. */
  build(): Hono {
    this._validateConfiguration();

    const basePath = this._config.basePath ?? `/api/${this._config.name}`;
    if (!basePath.startsWith("/")) {
      throw new Error(
        `Service basePath must start with "/"; received "${basePath}"`,
      );
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

    const onError =
      this._config.onError ?? createErrorHandler({ name: this._config.name });
    mountResolvedRoutes({
      app,
      onError,
      providers: this._providers,
      serviceConfig: this._config,
      versionMap: resolveVersions({
        definitions: this._versions,
        previewEndpoints: this._previewEndpoints,
      }),
    });
    app.onError(onError);
    return app;
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

/** Creates a new typed service builder. */
export function createService<TProject = unknown>(
  config: ServiceConfig,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
): ServiceBuilder<TProject, {}> {
  return new ServiceBuilder(config);
}

export { ServiceBuilder, VersionBuilder };
