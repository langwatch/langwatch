import { updateCurrentContext } from "@langwatch/observability/context";
import type { Context, MiddlewareHandler } from "hono";
import {
  type DescribeRouteOptions,
  describeRoute,
  resolver,
  uniqueSymbol,
  validator as zValidator,
} from "hono-openapi";

import {
  cacheReadMiddleware,
  rateLimitMiddleware,
  writeCachedResponse,
} from "./capabilities.js";
import {
  createApiSchemaError,
  parseApiSchemaSync,
  type ApiSchema,
  type ApiSchemaIssue,
} from "./schema.js";
import { serializeEndpointResult } from "./response.js";
import { createSSEResponse } from "./sse.js";
import { ENDPOINT_ROUTE } from "./types.js";
import type {
  BaseApp,
  EndpointDef,
  EndpointRegistration,
  ServiceConfig,
  VersionStatus,
} from "./types.js";
import type { ResolvedEndpoint } from "./versioning.js";

type ProviderMap<TProject> = Record<
  string,
  (base: BaseApp<TProject>) => unknown
>;
type ErrorHandler = NonNullable<ServiceConfig["onError"]>;

interface StackOptions<TProject> {
  ep: EndpointRegistration;
  onError: ErrorHandler;
  providers: ProviderMap<TProject>;
  serviceConfig: ServiceConfig;
  status: VersionStatus;
  /** The version namespace being mounted; always set — there is no bare alias. */
  version: string;
  /**
   * Where validated path params come from. `"route"` reads Hono's route match
   * (the eager mounts); `"context"` reads the date-namespace fallback's own
   * matcher, whose guard route never carried the endpoint's `:params`.
   */
  paramSource?: "route" | "context";
  /**
   * True for the date-namespace fallback stacks: they serve unregistered dates
   * and must never reach the document.
   */
  suppressDocs?: boolean;
}

/**
 * Composes the complete middleware pipeline for an active endpoint.
 *
 * The fixed order (ADR 003 §3): version context, auth, permission, rate limit,
 * resource limit, endpoint middleware, OpenAPI documentation, validation,
 * cache read, providers, handler.
 */
export function buildEndpointMiddlewareStack<TProject>(
  options: StackOptions<TProject>,
): MiddlewareHandler[] {
  const { ep, serviceConfig, status, version } = options;
  const { config } = ep;
  const stack = [versionContextMiddleware(options)];
  const documented =
    options.suppressDocs !== true && isDocumentedMount({ config, status });

  appendAuthMiddleware({ stack, config, serviceConfig });
  appendPermissionMiddleware({ stack, config, serviceConfig });

  if (config.rateLimit) {
    stack.push(
      rateLimitMiddleware({
        rateLimiter: serviceConfig.rateLimiter!,
        keyParts: {
          service: serviceConfig.name,
          path: ep.path,
          version,
        },
      }),
    );
  }

  if (config.resourceLimit) {
    const createResourceLimitMiddleware =
      serviceConfig._legacy?.resourceLimitMiddleware;
    if (!createResourceLimitMiddleware) {
      throw new Error(
        `Endpoint resource limit "${config.resourceLimit}" requires resourceLimitMiddleware`,
      );
    }
    stack.push(createResourceLimitMiddleware(config.resourceLimit));
  }

  if (config.middleware) stack.push(...config.middleware);

  appendOpenApiMiddleware({ stack, config, documented, status, version });
  appendValidationMiddleware({
    stack,
    ep,
    documented,
    paramSource: options.paramSource ?? "route",
  });
  stack.push(
    contextVariablesMiddleware(config, options.paramSource ?? "route"),
  );

  if (config.cache && config.output && ep.method !== "sse") {
    stack.push(
      cacheReadMiddleware({
        cache: serviceConfig.cache!,
        keyParts: {
          service: serviceConfig.name,
          path: ep.path,
          version,
        },
        hasInput: Boolean(config.input),
        declaredStatus: config.status,
      }),
    );
  }

  stack.push(providerMiddleware(options.providers));
  stack.push(handlerMiddleware(options));

  return stack;
}

/**
 * Whether this mount reaches the OpenAPI document.
 *
 * Every dated mount of a documented endpoint is published, plus `latest`, so a
 * pinned client sees the schemas its version actually serves. `preview` is
 * never documented: preview is where an endpoint may change without notice,
 * and documenting it would promise stability it does not have. `docs.hide`
 * opts the endpoint out entirely, and endpoints that declare nothing
 * documentable are skipped rather than published as bare stubs.
 */
function isDocumentedMount({
  config,
  status,
}: {
  config: EndpointDef;
  status: VersionStatus;
}): boolean {
  if (status === "preview") return false;
  if (config.docs?.hide === true) return false;
  return Boolean(config.output || config.docs);
}

/** Composes the inherited access pipeline and 410 response for a withdrawal. */
export function buildWithdrawnMiddlewareStack({
  ep,
  ...options
}: Omit<StackOptions<unknown>, "ep" | "providers" | "onError"> & {
  ep: ResolvedEndpoint & { withdrawn: true };
}): MiddlewareHandler[] {
  // A withdrawn endpoint gets the route too: its 410s are worth grouping by
  // endpoint like any other answer, and it is the mount most likely to have
  // someone asking who is still calling it.
  const stack = [versionContextMiddleware({ ...options, ep })];
  appendAuthMiddleware({
    stack,
    config: ep.config,
    serviceConfig: options.serviceConfig,
  });
  appendPermissionMiddleware({
    stack,
    config: ep.config,
    serviceConfig: options.serviceConfig,
  });
  if (ep.config.middleware) stack.push(...ep.config.middleware);
  stack.push(async (c) =>
    c.json(
      {
        code: "endpoint_withdrawn",
        message: "This endpoint has been removed",
      },
      410,
    ),
  );
  return stack;
}

function versionContextMiddleware({
  ep,
  status,
  version,
}: Pick<StackOptions<unknown>, "status" | "version"> & {
  // Only what the route identity is built from. A withdrawn endpoint has no
  // handler, and asking for the whole registration would exclude it from the
  // one field that says which endpoint its 410s belong to.
  ep: Pick<EndpointRegistration, "method" | "path"> & {
    config?: Pick<EndpointDef, "deprecated">;
  };
}): MiddlewareHandler {
  // Built once per endpoint at mount time rather than per request: the
  // registered path and method cannot change after the app is built.
  const route = `${(ep.method === "sse" ? "get" : ep.method).toUpperCase()} ${
    ep.path || "/"
  }`;
  const deprecated = ep.config?.deprecated;

  return async (c, next) => {
    c.set(ENDPOINT_ROUTE, route);
    try {
      await next();
    } finally {
      // The date-namespace fallback serves an UNREGISTERED date with the
      // effective version's stack: the header names the namespace that was
      // asked for, not the one whose registration answered.
      const answered =
        (c.get("apiVersionRequest") as string | undefined) ?? version;
      // Set in a `finally` so validation errors and 410 withdrawals carry the
      // version headers — and the deprecation warning — too.
      c.header("X-API-Version", answered);
      c.header("X-API-Version-Status", status);
      if (deprecated) {
        c.header("Deprecation", "true");
        c.header("X-API-Deprecation-Notice", deprecated);
      }
    }
  };
}

function appendAuthMiddleware({
  stack,
  config,
  serviceConfig,
}: {
  stack: MiddlewareHandler[];
  config: EndpointDef;
  serviceConfig: ServiceConfig;
}): void {
  const authSetting = config.auth ?? "default";
  if (authSetting === "default" && serviceConfig.auth) {
    stack.push(serviceConfig.auth);
  } else if (typeof authSetting === "function") {
    stack.push(authSetting);
  }

  if (authSetting !== "none" && serviceConfig._legacy?.organizationMiddleware) {
    stack.push(serviceConfig._legacy.organizationMiddleware);
  }
}

function appendPermissionMiddleware({
  stack,
  config,
  serviceConfig,
}: {
  stack: MiddlewareHandler[];
  config: EndpointDef;
  serviceConfig: ServiceConfig;
}): void {
  if (!config.permission) return;
  const enforce = serviceConfig.permissionEnforcer;
  if (!enforce) {
    throw new Error(
      `Endpoint declares permission "${config.permission}" but the service has no permissionEnforcer`,
    );
  }
  stack.push(enforce(config.permission));
}

function appendOpenApiMiddleware({
  stack,
  config,
  documented,
  status,
  version,
}: {
  stack: MiddlewareHandler[];
  config: EndpointDef;
  documented: boolean;
  status: VersionStatus;
  version: string;
}): void {
  if (!documented) return;

  const successStatus = String(config.status ?? 200);
  const generatedSuccess: NonNullable<
    DescribeRouteOptions["responses"]
  >[string] = config.output
    ? {
        description: "Success",
        content: {
          "application/json": { schema: resolver(config.output) },
        },
      }
    : { description: "Success" };

  const docs = config.docs;
  const options: DescribeRouteOptions = {
    responses: { [successStatus]: generatedSuccess, ...docs?.responses },
  };
  if (docs?.description !== undefined) options.description = docs.description;
  if (docs?.summary !== undefined) options.summary = docs.summary;
  if (docs?.tags !== undefined) options.tags = docs.tags;
  if (docs?.operationId !== undefined) {
    // Keep the declared id for the moving `latest` surface. Dated mounts need
    // distinct ids because OpenAPI requires operationId to be unique across
    // the whole document, including inherited registrations.
    options.operationId =
      status === "latest"
        ? docs.operationId
        : `${docs.operationId}_${version.replaceAll("-", "_")}`;
  }
  if (docs?.security !== undefined) options.security = docs.security;
  if (config.deprecated !== undefined) {
    // Deprecated still answers and warns — on every dated mount the
    // registration serves, so SDK generators surface it per version.
    options.deprecated = true;
    const notice = `Deprecated: ${config.deprecated}`;
    options.description = options.description
      ? `${options.description}\n\n${notice}`
      : notice;
  }

  stack.push(describeRoute(options) as unknown as MiddlewareHandler);
}

function appendValidationMiddleware({
  stack,
  ep,
  documented,
  paramSource,
}: {
  stack: MiddlewareHandler[];
  ep: EndpointRegistration;
  documented: boolean;
  paramSource: "route" | "context";
}): void {
  /**
   * The validation failure, as the error the boundary knows how to answer with.
   *
   * hono-openapi v0.4 handed the hook zod's `ZodError` itself; v1 wraps
   * `@hono/standard-validator` and hands over the Standard Schema failure — the
   * issue array, bare. Throwing that array reaches `onError` as a value with no
   * `name`, no `message` and no prototype it recognises, so a 400 that named
   * the offending field became an unhandled "Unknown Error" instead.
   *
   * The issues themselves are unchanged: zod's Standard Schema issues ARE
   * `ZodIssue`s, so re-wrapping restores exactly the error v0.4 threw.
   */
  const asZodError = (error: unknown): unknown =>
    Array.isArray(error)
      ? createApiSchemaError(error as ApiSchemaIssue[])
      : error;

  const addValidator = (
    target: "param" | "query" | "json",
    schema: ApiSchema | undefined,
  ) => {
    if (!schema) return;
    const middleware = zValidator(target, schema, (result) => {
      if (!result.success) throw asZodError(result.error);
    }) as unknown as MiddlewareHandler;
    if (!documented) {
      // hono-openapi's validator carries OpenAPI metadata under uniqueSymbol,
      // and generateSpecs indexes EVERY handler carrying it, so an
      // undocumented mount (preview, hidden) would otherwise still surface its
      // path in the spec. Validation is not documentation: strip the metadata,
      // keep the validator.
      delete (middleware as Partial<Record<typeof uniqueSymbol, unknown>>)[
        uniqueSymbol
      ];
    }
    stack.push(middleware);
  };

  if (ep.config.params && paramSource === "context") {
    // The date-namespace fallback matched the path itself, so Hono's route
    // params belong to the guard, not the endpoint. Validate the matcher's
    // extraction instead; the failure travels the same ZodError path.
    const schema = ep.config.params;
    stack.push(async (c, next) => {
      const parsed = parseApiSchemaSync(schema, c.get("routeParams") ?? {});
      if (!parsed.success) throw parsed.error;
      c.set("params", parsed.data);
      await next();
    });
  } else {
    addValidator("param", ep.config.params);
  }
  addValidator("query", ep.config.query);
  if (ep.method !== "sse") addValidator("json", ep.config.input);
}

/**
 * Publishes the validated path params and query string as context variables —
 * `c.get("params")` / `c.get("query")` — which is where Hono already puts
 * request state. Runs after the validators, so only parsed values are
 * published. Params validated by the date-namespace fallback are already
 * published by its own validator.
 */
function contextVariablesMiddleware(
  config: EndpointDef,
  paramSource: "route" | "context",
): MiddlewareHandler {
  return async (c, next) => {
    if (config.params && paramSource === "route") {
      c.set("params", c.req.valid("param" as never));
    }
    if (config.query) c.set("query", c.req.valid("query" as never));
    await next();
  };
}

function providerMiddleware<TProject>(
  providers: ProviderMap<TProject>,
): MiddlewareHandler {
  return async (c, next) => {
    const base: BaseApp<TProject> = {
      project: c.get("project"),
      _legacy: {
        organization: c.get("organization"),
        prisma: c.get("prisma"),
      },
    };

    updateCurrentContext({
      organizationId: c.get("organization")?.id,
      projectId: c.get("project")?.id,
      userId: c.get("user")?.id,
    });

    // Provided services become typed context variables: `c.get("things")`.
    const resolved = Object.entries(providers);
    await Promise.all(
      resolved.map(async ([key, factory]) => {
        c.set(key, await factory(base));
      }),
    );
    await next();
  };
}

function handlerMiddleware<TProject>({
  ep,
  onError,
  serviceConfig,
}: StackOptions<TProject>): MiddlewareHandler {
  const { config } = ep;
  if (ep.method === "sse") {
    return async (c) => {
      // The streaming response must reach the client before the producer can
      // safely write. createSSEResponse registers its lifecycle synchronously;
      // request logging and tracing defer finalization against that lifecycle.
      return createSSEResponse({
        c,
        events: (config.events ?? {}) as Record<string, ApiSchema>,
        handler: async (stream) => {
          await ep.handler(c, stream);
        },
        onError: async (error) => {
          await onError(error, c);
        },
      });
    };
  }

  return async (c: Context) => {
    const input = config.input ? c.req.valid("json" as never) : undefined;
    const result = await ep.handler(c, input);
    const response = serializeEndpointResult({ c, config, result });
    if (config.cache && config.output && !(result instanceof Response)) {
      await writeCachedResponse({
        c,
        cache: serviceConfig.cache!,
        cacheConfig: config.cache,
        response,
      });
    }
    return response;
  };
}
