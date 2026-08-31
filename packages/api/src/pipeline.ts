import { updateCurrentContext } from "@langwatch/observability/context";
import type { Context, MiddlewareHandler } from "hono";
import {
  type DescribeRouteOptions,
  describeRoute,
  resolver,
  uniqueSymbol,
  validator as zValidator,
} from "hono-openapi";
import { ZodError, type ZodIssue, type ZodType } from "zod";

import { serializeEndpointResult } from "./response.js";
import { createSSEResponse, type SSEConfig } from "./sse.js";
import { ENDPOINT_ROUTE } from "./types.js";
import type {
  BaseApp,
  EndpointConfig,
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
  isVersioned: boolean;
  onError: ErrorHandler;
  providers: ProviderMap<TProject>;
  serviceConfig: ServiceConfig;
  status: VersionStatus;
  version: string | null;
}

/** Composes the complete middleware pipeline for an active endpoint. */
export function buildEndpointMiddlewareStack<TProject>(
  options: StackOptions<TProject>,
): MiddlewareHandler[] {
  const { ep } = options;
  const stack = [versionContextMiddleware(options)];
  const documented = isDocumentedMount({
    config: ep.config,
    status: options.status,
  });

  appendAccessMiddleware({
    stack,
    config: ep.config,
    includeResourceLimit: true,
    serviceConfig: options.serviceConfig,
  });
  appendOpenApiMiddleware({ stack, config: ep.config, documented });
  appendValidationMiddleware({ stack, ep, documented });
  stack.push(providerMiddleware(options.providers));
  stack.push(handlerMiddleware(options));

  return stack;
}

/**
 * Whether this mount is the one that reaches the OpenAPI document.
 *
 * Only the bare alias (`status === "unversioned"`) is ever documented; dated,
 * `latest`, and `preview` mounts serve traffic (with version headers) but stay
 * out of the published spec, so the document contains exactly one path per
 * endpoint. `docs.hide` opts the endpoint out entirely, and endpoints that
 * declare nothing documentable are skipped rather than published as bare
 * stubs.
 */
function isDocumentedMount({
  config,
  status,
}: {
  config: EndpointConfig;
  status: VersionStatus;
}): boolean {
  if (status !== "unversioned") return false;
  if (config.docs?.hide === true) return false;
  return Boolean(config.output || config.description || config.docs);
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
  appendAccessMiddleware({
    stack,
    config: ep.config,
    includeResourceLimit: false,
    serviceConfig: options.serviceConfig,
  });
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
  isVersioned,
  status,
  version,
}: Pick<StackOptions<unknown>, "isVersioned" | "status" | "version"> & {
  // Only what the route identity is built from. A withdrawn endpoint has no
  // handler, and asking for the whole registration would exclude it from the
  // one field that says which endpoint its 410s belong to.
  ep: Pick<EndpointRegistration, "method" | "path">;
}): MiddlewareHandler {
  // Built once per endpoint at mount time rather than per request: the
  // registered path and method cannot change after the app is built.
  const route = `${(ep.method === "sse" ? "get" : ep.method).toUpperCase()} ${
    ep.path || "/"
  }`;

  return async (c, next) => {
    c.set(ENDPOINT_ROUTE, route);
    c.set("isVersionedRequest", isVersioned);
    if (version) c.set("apiVersion", version);
    try {
      await next();
    } finally {
      if (version) c.header("X-API-Version", version);
      c.header("X-API-Version-Status", status);
    }
  };
}

function appendAccessMiddleware({
  stack,
  config,
  includeResourceLimit,
  serviceConfig,
}: {
  stack: MiddlewareHandler[];
  config: EndpointConfig;
  includeResourceLimit: boolean;
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

  // Framework-mounted, deliberately BEFORE `config.middleware`: the check an
  // endpoint declares cannot be displaced by the middleware array it also
  // carries (the spread-overwrite that once left a declared policy
  // unenforced).
  if (config.permission) {
    const enforce = serviceConfig.permissionEnforcer;
    if (!enforce) {
      throw new Error(
        `Endpoint declares permission "${config.permission}" but the service has no permissionEnforcer`,
      );
    }
    stack.push(enforce(config.permission));
  }

  if (includeResourceLimit && config.resourceLimit) {
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
}

function appendOpenApiMiddleware({
  stack,
  config,
  documented,
}: {
  stack: MiddlewareHandler[];
  config: EndpointConfig;
  documented: boolean;
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
  if (config.description !== undefined)
    options.description = config.description;
  if (docs?.summary !== undefined) options.summary = docs.summary;
  if (docs?.tags !== undefined) options.tags = docs.tags;
  if (docs?.operationId !== undefined) options.operationId = docs.operationId;
  if (docs?.security !== undefined) options.security = docs.security;
  if (docs?.requestBody !== undefined) options.requestBody = docs.requestBody;

  stack.push(describeRoute(options) as unknown as MiddlewareHandler);
}

function appendValidationMiddleware({
  stack,
  ep,
  documented,
}: {
  stack: MiddlewareHandler[];
  ep: EndpointRegistration;
  documented: boolean;
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
    Array.isArray(error) ? new ZodError(error as ZodIssue[]) : error;

  const addValidator = (
    target: "param" | "query" | "json",
    schema: ZodType | undefined,
  ) => {
    if (!schema) return;
    const middleware = zValidator(target, schema, (result) => {
      if (!result.success) throw asZodError(result.error);
    }) as unknown as MiddlewareHandler;
    if (!documented) {
      // hono-openapi's validator carries OpenAPI metadata under uniqueSymbol,
      // and generateSpecs indexes EVERY handler carrying it, so an
      // undocumented mount (dated, latest, preview, hidden) would otherwise
      // still surface its path in the spec. Validation is not documentation:
      // strip the metadata, keep the validator.
      delete (middleware as Partial<Record<typeof uniqueSymbol, unknown>>)[
        uniqueSymbol
      ];
    }
    stack.push(middleware);
  };

  addValidator("param", ep.config.params);
  addValidator("query", ep.config.query);
  if (ep.method !== "sse") addValidator("json", ep.config.input);
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

    const resolved = Object.fromEntries(
      await Promise.all(
        Object.entries(providers).map(async ([key, factory]) => [
          key,
          await factory(base),
        ]),
      ),
    );
    c.set("app", { ...base, ...resolved });
    await next();
  };
}

function handlerMiddleware<TProject>({
  ep,
  onError,
}: StackOptions<TProject>): MiddlewareHandler {
  const { config } = ep;
  if (ep.method === "sse") {
    const sseConfig = config as unknown as SSEConfig<Record<string, ZodType>>;
    return async (c) => {
      const query = config.query ? c.req.valid("query" as never) : undefined;

      // The streaming response must reach the client before the producer can
      // safely write. createSSEResponse registers its lifecycle synchronously;
      // request logging and tracing defer finalization against that lifecycle.
      return createSSEResponse({
        c,
        events: sseConfig.events,
        handler: async (stream) => {
          await ep.handler(c, { query, app: c.get("app") }, stream);
        },
        onError: async (error) => {
          await onError(error, c);
        },
      });
    };
  }

  return async (c: Context) => {
    const result = await ep.handler(c, {
      input: config.input ? c.req.valid("json" as never) : undefined,
      params: config.params ? c.req.valid("param" as never) : undefined,
      query: config.query ? c.req.valid("query" as never) : undefined,
      app: c.get("app"),
    });
    return serializeEndpointResult({ c, config, result });
  };
}
