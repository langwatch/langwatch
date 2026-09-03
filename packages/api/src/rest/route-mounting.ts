import type { Context, Hono, MiddlewareHandler } from "hono";
import { mergePath } from "hono/utils/url";

import { ApiVersionUnavailableError } from "../errors.js";
import { runMiddlewareStack } from "./middleware-stack.js";
import { buildEndpointMiddlewareStack, buildWithdrawnMiddlewareStack } from "./pipeline.js";
import {
  mountOptionalVersionRoutes,
  mountRoute,
  mountStaticVersionRoutes,
} from "./public-rest-routing.js";
import type { BaseApp, HttpMethod, ServiceConfig, VersionStatus } from "./types.js";
import { isDateVersion } from "./types.js";
import { type ResolvedEndpoint, VERSION_LATEST, VERSION_PREVIEW } from "./versioning.js";

type ProviderMap<TProject> = Record<string, (base: BaseApp<TProject>, context: Context) => unknown>;
type ErrorHandler = NonNullable<ServiceConfig["onError"]>;

/**
 * Mounts every resolved version namespace and the two namespace guards.
 *
 * `createService` has no bare alias (ADR 002). Public REST adds its separate,
 * optional date-version routes after the explicit mounts (ADR 004).
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
  if (serviceConfig.publicRest?.staticVersioning) {
    mountStaticVersionRoutes({
      app,
      basePath,
      onError,
      providers,
      serviceConfig,
      versionMap,
    });
    return;
  }

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
  }

  if (serviceConfig.publicRest) {
    mountOptionalVersionRoutes({
      app,
      basePath,
      onError,
      providers,
      serviceConfig,
      versionMap,
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

  const versionNamespace = "/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
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
          operationIdSuffix: serviceConfig.publicRest && status === "latest" ? "latest" : void 0,
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

function resolveVersionStatus(version: string): VersionStatus {
  if (version === VERSION_LATEST) return "latest";
  if (version === VERSION_PREVIEW) return "preview";
  return "stable";
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
    if (!effective) {
      if (serviceConfig.publicRest) {
        throw new ApiVersionUnavailableError();
      }
      return next();
    }

    const rest = c.req.path.slice(basePath.length + requested.length + 1) || "/";
    const method = c.req.method.toLowerCase();
    for (const candidate of table.get(effective)!) {
      if (candidate.method !== method) continue;
      const params = matchPath(candidate.pattern, rest);
      if (!params) continue;
      c.set("routeParams", params);
      c.set("apiVersionRequest", requested);
      const response = await runMiddlewareStack(candidate.stack, c);
      if (response) return response;
      return next();
    }
    return next();
  };
}

/**
 * Matches an endpoint path against the request's remainder, extracting
 * `:params`. Supports the registerRoute path shapes: literal segments,
 * `:name`, `:name{constraint}` (the constraint is honored, not templated away)
 * and a trailing `*`.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
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
      params[name!] = decodePathParam(value);
      continue;
    }
    if (segment !== value) return null;
  }

  return pathSegments.length === patternSegments.length ? params : null;
}

function decodePathParam(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    // Hono still decodes each valid percent run when another run is malformed.
    // Keep the invalid bytes verbatim without discarding valid decoding around
    // them, so eager and fallback route params remain byte-for-byte equal.
    return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    });
  }
}

function splitSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}
