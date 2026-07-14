import { updateCurrentContext } from "@langwatch/observability/context";
import type { Context, MiddlewareHandler } from "hono";
import { describeRoute, type DescribeRouteOptions } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import type { ZodType } from "zod";

import { serializeEndpointResult } from "./response.js";
import { createSSEResponse, type SSEConfig } from "./sse.js";
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

  appendAccessMiddleware({
    stack,
    config: ep.config,
    includeResourceLimit: true,
    serviceConfig: options.serviceConfig,
  });
  appendOpenApiMiddleware(stack, ep.config);
  appendValidationMiddleware(stack, ep);
  stack.push(providerMiddleware(options.providers));
  stack.push(handlerMiddleware(options));

  return stack;
}

/** Composes the inherited access pipeline and 410 response for a withdrawal. */
export function buildWithdrawnMiddlewareStack({
  ep,
  ...options
}: Omit<StackOptions<unknown>, "ep" | "providers" | "onError"> & {
  ep: ResolvedEndpoint & { withdrawn: true };
}): MiddlewareHandler[] {
  const stack = [versionContextMiddleware(options)];
  appendAccessMiddleware({
    stack,
    config: ep.config,
    includeResourceLimit: false,
    serviceConfig: options.serviceConfig,
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

function versionContextMiddleware({
  isVersioned,
  status,
  version,
}: Pick<
  StackOptions<unknown>,
  "isVersioned" | "status" | "version"
>): MiddlewareHandler {
  return async (c, next) => {
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

  if (includeResourceLimit && config.resourceLimit) {
    stack.push(
      serviceConfig._legacy!.resourceLimitMiddleware!(config.resourceLimit),
    );
  }
  if (config.middleware) stack.push(...config.middleware);
}

function appendOpenApiMiddleware(
  stack: MiddlewareHandler[],
  config: EndpointConfig,
): void {
  if (!config.output && !config.description) return;

  const successStatus = String(config.status ?? 200);
  const responses: NonNullable<DescribeRouteOptions["responses"]> = {};
  responses[successStatus] = config.output
    ? {
        description: "Success",
        content: {
          "application/json": { schema: resolver(config.output) },
        },
      }
    : { description: "Success" };

  stack.push(
    describeRoute({
      description: config.description,
      responses,
    }) as unknown as MiddlewareHandler,
  );
}

function appendValidationMiddleware(
  stack: MiddlewareHandler[],
  ep: EndpointRegistration,
): void {
  const addValidator = (
    target: "param" | "query" | "json",
    schema: ZodType | undefined,
  ) => {
    if (!schema) return;
    stack.push(
      zValidator(target, schema, (result) => {
        if (!result.success) throw result.error;
      }) as unknown as MiddlewareHandler,
    );
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
