import { updateCurrentContext } from "@langwatch/observability/context";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  type DescribeRouteOptions,
  describeRoute,
  resolver,
  uniqueSymbol,
  validator as zValidator,
} from "hono-openapi";

import { cacheReadMiddleware, rateLimitMiddleware, writeCachedResponse } from "./capabilities.js";
import { isNoBodySchema } from "./definition.js";
import {
  ApiVersionConflictError,
  EndpointWithdrawnError,
  ProjectInputMismatchError,
} from "./errors.js";
import {
  createApiSchemaError,
  parseApiSchemaSync,
  type ApiSchema,
  type ApiSchemaIssue,
} from "./schema.js";
import {
  appendPublicRestDocumentationValidators,
  parsePublicRestInput,
  publicRestPathParams,
} from "./public-rest-input.js";
import { serializeEndpointResult } from "./response.js";
import { createSSEResponse } from "./sse.js";
import { ENDPOINT_INPUT, ENDPOINT_ROUTE } from "./types.js";
import type {
  BaseApp,
  EndpointDef,
  EndpointRegistration,
  ServiceConfig,
  VersionStatus,
} from "./types.js";
import type { ResolvedEndpoint } from "./versioning.js";

type ProviderMap<TProject> = Record<string, (base: BaseApp<TProject>, context: Context) => unknown>;
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
  /** Appended to an explicitly mounted operation id when another canonical mount owns it. */
  operationIdSuffix?: string;
  /** Documents date negotiation on an optional-version REST mount. */
  versionHeaderParameter?: string;
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
  if (serviceConfig.app) {
    stack.push(directAppMiddleware(serviceConfig.app));
  }
  const documented = options.suppressDocs !== true && isDocumentedMount({ config, status });

  appendAuthMiddleware({ stack, config, serviceConfig });
  if (ep.kind === "public-rest") {
    appendValidationMiddleware({
      stack,
      ep,
      documented,
      paramSource: options.paramSource ?? "route",
    });
    stack.push(
      validatedInputMiddleware({
        config,
        kind: ep.kind,
        maxInputBytes: serviceConfig.publicRest?.maxInputBytes,
        paramSource: options.paramSource ?? "route",
      }),
    );
    stack.push(projectInputMiddleware(serviceConfig));
  }
  appendPermissionMiddleware({ stack, config, serviceConfig });
  stack.push(
    requestCapabilitiesMiddleware({
      actor: serviceConfig.actor,
      authorize: serviceConfig.authorize,
    }),
  );

  if (config.rateLimit) {
    stack.push(
      rateLimitMiddleware({
        rateLimiter: serviceConfig.rateLimiter!,
        keyParts: {
          service: serviceConfig.name,
          method: ep.method === "sse" ? "get" : ep.method,
          path: ep.path,
          version,
        },
      }),
    );
  }

  if (config.resourceLimit) {
    const createResourceLimitMiddleware = serviceConfig._legacy?.resourceLimitMiddleware;
    if (!createResourceLimitMiddleware) {
      throw new Error(
        `Endpoint resource limit "${config.resourceLimit}" requires resourceLimitMiddleware`,
      );
    }
    stack.push(createResourceLimitMiddleware(config.resourceLimit));
  }

  if (config.middleware) stack.push(...config.middleware);

  appendOpenApiMiddleware({
    stack,
    config,
    documented,
    kind: ep.kind,
    operationIdSuffix: options.operationIdSuffix,
    status,
    version,
    versionHeaderParameter: options.versionHeaderParameter,
  });
  if (ep.kind !== "public-rest") {
    appendValidationMiddleware({
      stack,
      ep,
      documented,
      paramSource: options.paramSource ?? "route",
    });
    stack.push(
      validatedInputMiddleware({
        config,
        kind: ep.kind,
        maxInputBytes: serviceConfig.publicRest?.maxInputBytes,
        paramSource: options.paramSource ?? "route",
      }),
    );
  }

  if (config.cache && config.output && ep.method !== "sse") {
    stack.push(
      cacheReadMiddleware({
        cache: serviceConfig.cache!,
        keyParts: {
          service: serviceConfig.name,
          method: ep.method,
          path: ep.path,
          version,
        },
        declaredStatus: config.status,
      }),
    );
  }

  stack.push(providerMiddleware(options.providers));
  stack.push(handlerMiddleware(options));

  return stack;
}

function directAppMiddleware(resolve: NonNullable<ServiceConfig["app"]>): MiddlewareHandler {
  return async (context, next) => {
    Object.defineProperty(context, "app", {
      configurable: true,
      enumerable: false,
      value: resolve(context),
    });
    await next();
  };
}

function requestCapabilitiesMiddleware(
  options: Pick<ServiceConfig, "actor" | "authorize">,
): MiddlewareHandler {
  return async (context, next) => {
    Object.defineProperty(context, "actor", {
      configurable: true,
      enumerable: false,
      value: () => {
        if (!options.actor) {
          throw new Error("This API service has no authenticated actor resolver");
        }
        return options.actor(context);
      },
    });
    Object.defineProperty(context, "authorize", {
      configurable: true,
      enumerable: false,
      value: (permission: Parameters<NonNullable<ServiceConfig["authorize"]>>[1]) => {
        if (!options.authorize) {
          throw new Error("This API service has no dynamic permission authorizer");
        }
        return options.authorize(context, permission);
      },
    });
    await next();
  };
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
  stack.push(async () => {
    throw new EndpointWithdrawnError();
  });
  return stack;
}

function versionContextMiddleware({
  ep,
  serviceConfig,
  status,
  version,
}: Pick<StackOptions<unknown>, "serviceConfig" | "status" | "version"> & {
  // Only what the route identity is built from. A withdrawn endpoint has no
  // handler, and asking for the whole registration would exclude it from the
  // one field that says which endpoint its 410s belong to.
  ep: Pick<EndpointRegistration, "method" | "path"> & {
    config?: Pick<EndpointDef, "deprecated">;
  };
}): MiddlewareHandler {
  // Built once per endpoint at mount time rather than per request: the
  // registered path and method cannot change after the app is built.
  const route = `${(ep.method === "sse" ? "get" : ep.method).toUpperCase()} ${ep.path || "/"}`;
  const deprecated = ep.config?.deprecated;

  return async (c, next) => {
    c.set(ENDPOINT_ROUTE, route);
    const staticVersioning = serviceConfig.publicRest?.staticVersioning;
    const staticSelection = staticVersioning?.selector.select({
      pathVersion: staticVersioning.pathVersion,
      headerVersion: staticVersioning
        ? (c.req.header(staticVersioning.selector.headerName) ?? void 0)
        : void 0,
    });
    try {
      if (!staticSelection) {
        const requested = (c.get("apiVersionRequest") as string | undefined) ?? version;
        const versionHeader = serviceConfig.publicRest?.versionHeader;
        const headerVersion = versionHeader ? c.req.header(versionHeader) : void 0;
        if (headerVersion && headerVersion !== requested) {
          throw new ApiVersionConflictError();
        }
      }
      await next();
    } finally {
      // The date-namespace fallback serves an UNREGISTERED date with the
      // effective version's stack: the header names the namespace that was
      // asked for, not the one whose registration answered.
      const answered =
        staticSelection?.version ?? (c.get("apiVersionRequest") as string | undefined) ?? version;
      // Set in a `finally` so validation errors and 410 withdrawals carry the
      // version headers — and the deprecation warning — too.
      c.header("X-API-Version", answered);
      c.header(
        "X-API-Version-Status",
        staticSelection?.source === "latest" ? "latest" : staticSelection ? "stable" : status,
      );
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
  kind,
  status,
  version,
  operationIdSuffix,
  versionHeaderParameter,
}: {
  stack: MiddlewareHandler[];
  config: EndpointDef;
  documented: boolean;
  kind: EndpointRegistration["kind"];
  status: VersionStatus;
  version: string;
  operationIdSuffix?: string;
  versionHeaderParameter?: string;
}): void {
  if (!documented) return;

  const isPublicNoBody = kind === "public-rest" && config.output && isNoBodySchema(config.output);
  const successStatus = String(config.status ?? (isPublicNoBody ? 204 : 200));
  const generatedSuccess: NonNullable<DescribeRouteOptions["responses"]>[string] =
    config.output && !isPublicNoBody
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
  if (versionHeaderParameter) {
    options.parameters = [
      {
        description:
          "Optional date API version. Omit it for latest; use a dated URL to pin the same contract visibly.",
        in: "header",
        name: versionHeaderParameter,
        required: false,
        schema: {
          default: "latest",
          pattern: "^(latest|20\\d{2}-\\d{2}-\\d{2})$",
          type: "string",
        },
      },
    ];
  }
  if (docs?.description !== undefined) options.description = docs.description;
  if (docs?.summary !== undefined) options.summary = docs.summary;
  if (docs?.tags !== undefined) options.tags = docs.tags;
  if (docs?.operationId !== undefined) {
    // Keep the declared id for the moving `latest` surface. Dated mounts need
    // distinct ids because OpenAPI requires operationId to be unique across
    // the whole document, including inherited registrations.
    const suffix =
      operationIdSuffix ?? (status === "latest" ? void 0 : version.replaceAll("-", "_"));
    options.operationId = suffix ? `${docs.operationId}_${suffix}` : docs.operationId;
  }
  if (docs?.security !== undefined) options.security = docs.security;
  if (config.deprecated !== undefined) {
    // Deprecated still answers and warns — on every dated mount the
    // registration serves, so SDK generators surface it per version.
    options.deprecated = true;
    const notice = `Deprecated: ${config.deprecated}`;
    options.description = options.description ? `${options.description}\n\n${notice}` : notice;
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
  if (ep.kind === "public-rest") {
    if (documented) {
      appendPublicRestDocumentationValidators({ stack, endpoint: ep });
    }
    return;
  }

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
    Array.isArray(error) ? createApiSchemaError(error as ApiSchemaIssue[]) : error;

  const addValidator = (target: "param" | "query" | "json", schema: ApiSchema | undefined) => {
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
      delete (middleware as Partial<Record<typeof uniqueSymbol, unknown>>)[uniqueSymbol];
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
 * Builds the one validated handler input after the source validators run.
 * REST flattens path, query and JSON object fields; RPC uses its JSON value.
 * SSE keeps query on context because its second argument is the stream.
 */
function validatedInputMiddleware({
  config,
  kind,
  maxInputBytes,
  paramSource,
}: {
  config: EndpointDef;
  kind: EndpointRegistration["kind"];
  maxInputBytes: number | undefined;
  paramSource: "route" | "context";
}): MiddlewareHandler {
  return async (c, next) => {
    const params = validatedPathParams({ c, config, kind, paramSource });
    const query = config.query ? c.req.valid("query" as never) : void 0;

    if (kind === "sse") {
      if (query !== void 0) {
        c.set("query", query);
      }
      await next();
      return;
    }

    if (kind === "public-rest") {
      const input = await parsePublicRestInput({
        context: c,
        method: c.req.method.toLowerCase() as EndpointRegistration["method"],
        maxInputBytes,
        params,
        schema: config.input,
      });
      c.set(ENDPOINT_INPUT, input);
      await next();
      return;
    }

    const body = config.input ? c.req.valid("json" as never) : void 0;
    const input = kind === "rest" ? mergeRestInput({ params, query, body }) : body;
    c.set(ENDPOINT_INPUT, input);
    await next();
  };
}

function validatedPathParams({
  c,
  config,
  kind,
  paramSource,
}: {
  c: Context;
  config: EndpointDef;
  kind: EndpointRegistration["kind"];
  paramSource: "route" | "context";
}): unknown {
  if (kind === "public-rest") {
    return publicRestPathParams({ context: c, source: paramSource });
  }
  if (!config.params) {
    return void 0;
  }
  return paramSource === "route" ? c.req.valid("param" as never) : c.get("params");
}

function mergeRestInput({
  params,
  query,
  body,
}: {
  params: unknown;
  query: unknown;
  body: unknown;
}): Record<string, unknown> | undefined {
  if (params === void 0 && query === void 0 && body === void 0) {
    return void 0;
  }

  const input: Record<string, unknown> = {};

  addRestInputPart(input, "path", params);
  addRestInputPart(input, "query", query);
  addRestInputPart(input, "body", body);

  return input;
}

function addRestInputPart(
  input: Record<string, unknown>,
  source: "path" | "query" | "body",
  part: unknown,
): void {
  if (part === void 0) {
    return;
  }
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

function providerMiddleware<TProject>(providers: ProviderMap<TProject>): MiddlewareHandler {
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
        c.set(key, await factory(base, c));
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
    const input = c.get(ENDPOINT_INPUT);
    if (ep.kind !== "public-rest") {
      assertAuthorizedProjectInput({
        context: c,
        input,
        required: serviceConfig.projectIdInput === true,
      });
    }
    const result = await ep.handler(c, input);
    const response = serializeEndpointResult({ c, config, kind: ep.kind, result });
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

function projectInputMiddleware(serviceConfig: ServiceConfig): MiddlewareHandler {
  return async (context, next) => {
    assertAuthorizedProjectInput({
      context,
      input: context.get(ENDPOINT_INPUT),
      required: serviceConfig.projectIdInput === true,
    });
    await next();
  };
}

function assertAuthorizedProjectInput({
  context,
  input,
  required,
}: {
  context: Context;
  input: unknown;
  required: boolean;
}): void {
  if (!required) return;
  const inputProject = z.object({ projectId: z.string() }).safeParse(input);
  const authorizedProject = z.object({ id: z.string() }).safeParse(context.get("project"));
  if (
    !inputProject.success ||
    !authorizedProject.success ||
    inputProject.data.projectId !== authorizedProject.data.id
  ) {
    throw new ProjectInputMismatchError();
  }
}
