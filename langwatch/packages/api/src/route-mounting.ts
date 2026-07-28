import { Hono, type MiddlewareHandler } from "hono";

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
  VERSION_LATEST,
  VERSION_PREVIEW,
  type ResolvedEndpoint,
} from "./versioning.js";

type ProviderMap<TProject> = Record<
  string,
  (base: BaseApp<TProject>) => unknown
>;
type ErrorHandler = NonNullable<ServiceConfig["onError"]>;

/** Mounts all resolved versions, namespace guards, and the bare latest alias. */
export function mountResolvedRoutes<TProject>({
  app,
  onError,
  providers,
  serviceConfig,
  versionMap,
}: {
  app: Hono;
  onError: ErrorHandler;
  providers: ProviderMap<TProject>;
  serviceConfig: ServiceConfig;
  versionMap: Map<string, ResolvedEndpoint[]>;
}): void {
  for (const [version, endpoints] of versionMap) {
    mountVersion({
      app,
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
  app.all(versionNamespace, (c) => c.notFound());
  app.all(`${versionNamespace}/*`, (c) => c.notFound());

  const latestEndpoints = versionMap.get(VERSION_LATEST);
  if (latestEndpoints) {
    mountVersion({
      app,
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
  endpoints,
  onError,
  providers,
  serviceConfig,
  status,
  version,
}: {
  app: Hono;
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
