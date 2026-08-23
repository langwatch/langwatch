import type { Context, Hono, MiddlewareHandler } from "hono";
import { mergePath } from "hono/utils/url";

import {
  buildServiceCatalogue,
  DISCOVER_NAME,
  type ServiceCatalogue,
} from "./discover.js";
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
import { isDateVersion } from "./types.js";
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

/**
 * Mounts every resolved version namespace and the two namespace guards.
 *
 * There is no bare alias (ADR 002): a request without a version segment is an
 * unknown namespace and answers 404 like any other unknown version.
 */
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
    const status = resolveVersionStatus(version);
    mountVersion({
      app,
      basePath,
      endpoints,
      onError,
      providers,
      serviceConfig,
      status,
      version,
    });
    mountDiscover({
      app,
      basePath,
      endpoints,
      serviceConfig,
      status,
      version,
    });
  }

  // The date-namespace fallback. An endpoint serves at version V its latest
  // registration dated on or before V, and V is whatever real date the caller
  // asked for — registered or not. The eager mounts cover the registered
  // versions; this dispatches every other real date to the effective version's
  // stack, and falls through to the 404 guard for anything that is not a
  // servable date.
  const fallback = buildDateFallback({
    basePath,
    onError,
    providers,
    serviceConfig,
    versionMap,
  });

  const versionNamespace =
    "/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
  const notFound: MiddlewareHandler = async (c) => c.notFound();
  for (const guardPath of [versionNamespace, `${versionNamespace}/*`]) {
    const handlers: [MiddlewareHandler, ...MiddlewareHandler[]] = fallback
      ? [fallback, notFound]
      : [notFound];
    app.all(guardPath, ...handlers);
    serviceConfig.onRouteMounted?.({
      method: "all",
      path: mergePath(basePath, guardPath),
      version: null,
      status: null,
      withdrawn: false,
      isNamespaceGuard: true,
      config: null,
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
  version: string;
}): void {
  for (const ep of endpoints) {
    const path = `/${version}${ep.path || "/"}`;
    const method = ep.method === "sse" ? "get" : ep.method;
    const stack = ep.withdrawn
      ? buildWithdrawnMiddlewareStack({ ep, serviceConfig, status, version })
      : buildEndpointMiddlewareStack({
          ep,
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

/**
 * Mounts the service's own RPC catalogue at `/{version}/rpc.discover`, once
 * per namespace. It answers without the service's auth or endpoint pipeline:
 * it is meta — the same information the published document carries — and
 * carries no tenant data. The version headers ride the same `finally` the
 * endpoint stacks use.
 */
function mountDiscover({
  app,
  basePath,
  endpoints,
  serviceConfig,
  status,
  version,
}: {
  app: Hono;
  basePath: string;
  endpoints: ResolvedEndpoint[];
  serviceConfig: ServiceConfig;
  status: VersionStatus;
  version: string;
}): void {
  // The catalogue is computed once and memoized: the registrations it is
  // derived from cannot change while the process runs. The computation is
  // async — the schema converter lazy-loads its vendor chunk — so it happens
  // on first request rather than at build.
  let catalogue: ServiceCatalogue | undefined;

  const path = `/${version}/${DISCOVER_NAME}`;
  const stack: MiddlewareHandler[] = [
    async (c, next) => {
      try {
        await next();
      } finally {
        c.header("X-API-Version", version);
        c.header("X-API-Version-Status", status);
      }
    },
    async (c) => {
      catalogue ??= await buildServiceCatalogue({
        basePath,
        namespace: version,
        endpoints,
        openapiUrl: serviceConfig.openapiUrl,
        // Preview endpoints are never documented, so a preview catalogue lists
        // nothing — it still answers, and still points at the document.
        documentable: status !== "preview",
      });
      return c.json(catalogue);
    },
  ];
  app.post(path, stack[0]!, stack[1]!);
  serviceConfig.onRouteMounted?.({
    method: "post",
    path: mergePath(basePath, path),
    version,
    status,
    withdrawn: false,
    isDiscoverEndpoint: true,
    config: null,
  });
}

// ---------------------------------------------------------------------------
// The date-namespace fallback
// ---------------------------------------------------------------------------

interface FallbackCandidate {
  method: string;
  pattern: string;
  stack: MiddlewareHandler[];
}

/**
 * Pre-builds the dispatch stacks for unregistered dates: one candidate list
 * per effective dated version, always undocumented (unregistered dates are not
 * in the document) and validating params off the fallback's own path match.
 * Returns null when no dated version exists, leaving the guards as plain 404s.
 */
function buildDateFallback<TProject>({
  basePath,
  onError,
  providers,
  serviceConfig,
  versionMap,
}: {
  basePath: string;
  onError: ErrorHandler;
  providers: ProviderMap<TProject>;
  serviceConfig: ServiceConfig;
  versionMap: Map<string, ResolvedEndpoint[]>;
}): MiddlewareHandler | null {
  const datedVersions = [...versionMap.keys()]
    .filter((version) => isDateVersion(version))
    .sort((a, b) => a.localeCompare(b));
  if (datedVersions.length === 0) return null;

  const table = new Map<string, FallbackCandidate[]>();
  for (const version of datedVersions) {
    const candidates: FallbackCandidate[] = [];
    for (const ep of versionMap.get(version)!) {
      const stack = ep.withdrawn
        ? buildWithdrawnMiddlewareStack({
            ep,
            serviceConfig,
            status: "stable",
            version,
          })
        : buildEndpointMiddlewareStack({
            ep,
            onError,
            providers,
            serviceConfig,
            status: "stable",
            version,
            paramSource: "context",
            suppressDocs: true,
          });
      candidates.push({
        method: ep.method === "sse" ? "get" : ep.method,
        pattern: ep.path || "/",
        stack,
      });
    }
    table.set(version, candidates);
  }

  return async (c, next) => {
    const requested = c.req.param("apiVersion") ?? "";
    if (!isDateVersion(requested)) return next();

    // The latest registered version dated on or before the requested one.
    let effective: string | undefined;
    for (const version of datedVersions) {
      if (version <= requested) effective = version;
    }
    if (!effective) return next();

    const rest =
      c.req.path.slice(basePath.length + requested.length + 1) || "/";
    const method = c.req.method.toLowerCase();
    for (const candidate of table.get(effective)!) {
      if (candidate.method !== method) continue;
      const params = matchPath(candidate.pattern, rest);
      if (!params) continue;
      c.set("routeParams", params);
      c.set("apiVersionRequest", requested);
      const response = await runStack(candidate.stack, c);
      if (response) return response;
      return next();
    }
    return next();
  };
}

/**
 * Runs a pre-built middleware stack outside Hono's router: handlers that
 * answer without calling `next` (the 410, a 429, a cache hit) short-circuit,
 * and the final handler's response is the answer.
 *
 * Each returned response is assigned to `c.res`, mirroring Hono's own
 * dispatcher — without it, headers set in a `finally` after `next()` (the
 * version headers) would land on prepared headers that nothing merges.
 */
async function runStack(
  stack: MiddlewareHandler[],
  c: Context,
): Promise<Response | undefined> {
  let index = 0;
  const dispatch = async (): Promise<Response | undefined> => {
    const handler = stack[index++];
    if (!handler) return undefined;
    let inner: Response | undefined;
    const returned = await handler(c, async () => {
      inner = await dispatch();
    });
    const response = returned instanceof Response ? returned : inner;
    if (response) c.res = response;
    return response;
  };
  return dispatch();
}

/**
 * Matches an endpoint path against the request's remainder, extracting
 * `:params`. Supports the registerRoute path shapes: literal segments,
 * `:name`, `:name{constraint}` (the constraint is honored, not templated away)
 * and a trailing `*`.
 */
export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternSegments = splitSegments(pattern);
  const pathSegments = splitSegments(path);
  const params: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const segment = patternSegments[i]!;
    if (segment === "*") return params;
    const value = pathSegments[i];
    if (value === undefined) return null;
    if (segment.startsWith(":")) {
      const match = /^:([^{?]+)(\{(.+)\})?$/.exec(segment);
      if (!match) return null;
      const [, name, , constraint] = match;
      if (constraint && !new RegExp(`^${constraint}$`).test(value)) {
        return null;
      }
      params[name!] = value;
      continue;
    }
    if (segment !== value) return null;
  }

  return pathSegments.length === patternSegments.length ? params : null;
}

function splitSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}
