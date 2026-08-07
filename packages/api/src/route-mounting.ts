import type { Hono, MiddlewareHandler } from "hono";
import { mergePath } from "hono/utils/url";

import {
  buildEndpointMiddlewareStack,
  buildWithdrawnMiddlewareStack,
} from "./pipeline.js";
import type {
  BaseApp,
  HttpMethod,
  ServiceConfig,
  VersionStatus,
} from "./types.js";
import {
  type ResolvedEndpoint,
  VERSION_LATEST,
  VERSION_PREVIEW,
} from "./versioning.js";

type ProviderMap<TProject> = Record<
  string,
  (base: BaseApp<TProject>) => unknown
>;
type ErrorHandler = NonNullable<ServiceConfig["onError"]>;

/** Mounts all resolved versions, namespace guards, and the bare latest alias. */
export function mountResolvedRoutes<TProject>({
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
  for (const [version, endpoints] of versionMap) {
    mountVersion({
      app,
      basePath,
      endpoints,
      onError,
      providers,
      serviceConfig,
      status: resolveVersionStatus(version),
      version,
    });
  }

  const versionNamespace =
    "/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
  for (const guardPath of [versionNamespace, `${versionNamespace}/*`]) {
    app.all(guardPath, (c) => c.notFound());
    serviceConfig.onRouteMounted?.({
      method: "all",
      path: mergePath(basePath, guardPath),
      version: null,
      status: "unversioned",
      withdrawn: false,
      namespaceGuard: true,
      config: null,
    });
  }

  const latestEndpoints = versionMap.get(VERSION_LATEST);
  if (latestEndpoints) {
    mountVersion({
      app,
      basePath,
      endpoints: latestEndpoints,
      onError,
      providers,
      serviceConfig,
      status: "unversioned",
      version: null,
    });
  }
}

function mountVersion<TProject>({
  app,
  basePath,
  endpoints,
  onError,
  providers,
  serviceConfig,
  status,
  version,
}: {
  app: Hono;
  basePath: string;
  endpoints: ResolvedEndpoint[];
  onError: ErrorHandler;
  providers: ProviderMap<TProject>;
  serviceConfig: ServiceConfig;
  status: VersionStatus;
  version: string | null;
}): void {
  const prefix = version ? `/${version}` : "";
  const isVersioned = status !== "unversioned";

  for (const ep of endpoints) {
    const path = `${prefix}${ep.path || "/"}`;
    const method = ep.method === "sse" ? "get" : ep.method;
    const stack = ep.withdrawn
      ? buildWithdrawnMiddlewareStack({
          ep,
          isVersioned,
          serviceConfig,
          status,
          version,
        })
      : buildEndpointMiddlewareStack({
          ep,
          isVersioned,
          onError,
          providers,
          serviceConfig,
          status,
          version,
        });
    mountRoute({ app, method, path, stack });
    serviceConfig.onRouteMounted?.({
      method,
      // mergePath is what Hono itself applies a basePath with, so the
      // reported string is byte-identical to app.routes[i].path.
      path: mergePath(basePath, path),
      version,
      status,
      withdrawn: ep.withdrawn === true,
      config: ep.config,
    });
  }
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

function resolveVersionStatus(version: string): VersionStatus {
  if (version === VERSION_LATEST) return "latest";
  if (version === VERSION_PREVIEW) return "preview";
  return "stable";
}
