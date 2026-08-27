import type { Context, Hono, MiddlewareHandler } from "hono";
import { mergePath } from "hono/utils/url";
import { uniqueSymbol } from "hono-openapi";

import { ApiVersionUnavailableError, InvalidApiVersionError } from "./errors.js";
import { runMiddlewareStack } from "./middleware-stack.js";
import { buildEndpointMiddlewareStack, buildWithdrawnMiddlewareStack } from "./pipeline.js";
import type { BaseApp, EndpointRegistration, HttpMethod, ServiceConfig } from "./types.js";
import { isDateVersion } from "./types.js";
import { type ResolvedEndpoint, VERSION_LATEST } from "./versioning.js";

type ProviderMap<TProject> = Record<string, (base: BaseApp<TProject>, context: Context) => unknown>;
type ErrorHandler = NonNullable<ServiceConfig["onError"]>;

interface Candidate {
  stack: MiddlewareHandler[];
}

export function mountOptionalVersionRoutes<TProject>({
  app,
  basePath,
  onError,
  providers,
  serviceConfig,
  versionMap,
}: {
  app: Hono;
  basePath: string;
  onError: ErrorHandler;
  providers: ProviderMap<TProject>;
  serviceConfig: ServiceConfig;
  versionMap: Map<string, ResolvedEndpoint[]>;
}): void {
  const latest = versionMap.get(VERSION_LATEST);
  if (!latest) {
    return;
  }

  const datedVersions = [...versionMap.keys()]
    .filter(isDateVersion)
    .sort((a, b) => a.localeCompare(b));
  const candidates = buildCandidates({
    datedVersions,
    onError,
    providers,
    serviceConfig,
    versionMap,
  });

  for (const endpoint of latest) {
    mountOptionalEndpoint({
      app,
      basePath,
      candidates,
      datedVersions,
      endpoint,
      onError,
      providers,
      serviceConfig,
    });
  }
}

function buildCandidates<TProject>({
  datedVersions,
  onError,
  providers,
  serviceConfig,
  versionMap,
}: {
  datedVersions: string[];
  onError: ErrorHandler;
  providers: ProviderMap<TProject>;
  serviceConfig: ServiceConfig;
  versionMap: Map<string, ResolvedEndpoint[]>;
}): Map<string, Map<string, Candidate>> {
  const candidates = new Map<string, Map<string, Candidate>>();
  for (const version of [...datedVersions, VERSION_LATEST]) {
    const byEndpoint = new Map<string, Candidate>();
    for (const endpoint of versionMap.get(version) ?? []) {
      const status = version === VERSION_LATEST ? "latest" : "stable";
      const stack = endpoint.withdrawn
        ? buildWithdrawnMiddlewareStack({
            ep: endpoint,
            serviceConfig,
            status,
            version,
          })
        : buildEndpointMiddlewareStack({
            ep: endpoint,
            onError,
            providers,
            serviceConfig,
            status,
            suppressDocs: true,
            version,
          });
      byEndpoint.set(endpointKey(endpoint), { stack });
    }
    candidates.set(version, byEndpoint);
  }
  return candidates;
}

function mountOptionalEndpoint<TProject>({
  app,
  basePath,
  candidates,
  datedVersions,
  endpoint,
  onError,
  providers,
  serviceConfig,
}: {
  app: Hono;
  basePath: string;
  candidates: Map<string, Map<string, Candidate>>;
  datedVersions: string[];
  endpoint: ResolvedEndpoint;
  onError: ErrorHandler;
  providers: ProviderMap<TProject>;
  serviceConfig: ServiceConfig;
}): void {
  const method = endpoint.method === "sse" ? "get" : endpoint.method;
  const path = endpoint.path || "/";
  const documentation = endpoint.withdrawn
    ? []
    : documentationMiddleware({ endpoint, onError, providers, serviceConfig });
  const dispatch = optionalVersionDispatcher({
    candidates,
    datedVersions,
    endpoint,
    serviceConfig,
  });
  mountRoute({ app, method, path, stack: [...documentation, dispatch] });
  serviceConfig.onRouteMounted?.({
    method,
    path: mergePath(basePath, path),
    version: null,
    status: null,
    withdrawn: endpoint.withdrawn === true,
    isOptionalVersionRoute: true,
    config: endpoint.config,
  });
}

function documentationMiddleware<TProject>({
  endpoint,
  onError,
  providers,
  serviceConfig,
}: {
  endpoint: EndpointRegistration;
  onError: ErrorHandler;
  providers: ProviderMap<TProject>;
  serviceConfig: ServiceConfig;
}): MiddlewareHandler[] {
  const stack = buildEndpointMiddlewareStack({
    ep: endpoint,
    onError,
    providers,
    serviceConfig,
    status: "latest",
    version: VERSION_LATEST,
    versionHeaderParameter: serviceConfig.publicRest?.versionHeader,
  });

  return stack.flatMap((handler) => {
    const metadata: unknown = Reflect.get(handler, uniqueSymbol);
    if (metadata === void 0) {
      return [];
    }

    const noop: MiddlewareHandler = async (_context, next) => {
      await next();
    };
    Object.defineProperty(noop, uniqueSymbol, { value: metadata });
    return [noop];
  });
}

function optionalVersionDispatcher({
  candidates,
  datedVersions,
  endpoint,
  serviceConfig,
}: {
  candidates: Map<string, Map<string, Candidate>>;
  datedVersions: string[];
  endpoint: ResolvedEndpoint;
  serviceConfig: ServiceConfig;
}): MiddlewareHandler {
  return async (context) => {
    const header = serviceConfig.publicRest?.versionHeader;
    const requested = header ? (context.req.header(header) ?? VERSION_LATEST) : VERSION_LATEST;
    if (requested !== VERSION_LATEST && !isDateVersion(requested)) {
      throw new InvalidApiVersionError();
    }

    const effective = effectiveVersion({ datedVersions, requested });
    const candidate = effective ? candidates.get(effective)?.get(endpointKey(endpoint)) : void 0;
    if (!candidate) {
      throw new ApiVersionUnavailableError();
    }

    context.set("apiVersionRequest", requested);
    return (await runMiddlewareStack(candidate.stack, context)) ?? context.notFound();
  };
}

function effectiveVersion({
  datedVersions,
  requested,
}: {
  datedVersions: string[];
  requested: string;
}): string | undefined {
  if (requested === VERSION_LATEST) {
    return VERSION_LATEST;
  }

  let effective: string | undefined;
  for (const version of datedVersions) {
    if (version <= requested) {
      effective = version;
    }
  }
  return effective;
}

function endpointKey(endpoint: Pick<ResolvedEndpoint, "method" | "path">): string {
  const method = endpoint.method === "sse" ? "get" : endpoint.method;
  return `${method}:${endpoint.path || "/"}`;
}

function mountRoute({
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
  const register: Record<HttpMethod, () => void> = {
    get: () => void app.get(path, ...handlers),
    post: () => void app.post(path, ...handlers),
    put: () => void app.put(path, ...handlers),
    delete: () => void app.delete(path, ...handlers),
    patch: () => void app.patch(path, ...handlers),
  };
  register[method]();
}
