/**
 * Compatibility layer: next/router → react-router
 *
 * This module provides a `useRouter()` hook that mimics the Next.js Pages Router API
 * using React Router primitives. It allows gradual migration of components that depend
 * on `next/router` without rewriting every single one immediately.
 *
 * Supported features:
 * - router.query (merged route params + URL search params)
 * - router.push(url, as?, options?) / router.replace(url, as?, options?)
 * - router.pathname (route pattern)
 * - router.asPath (actual URL path + query)
 * - router.isReady (always true in SPA)
 * - router.back()
 * - router.events (fires routeChangeComplete on navigation for PostHog/activity tracking)
 */
import { useEffect, useMemo } from "react";
import {
  matchPath,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

// Route patterns for resolving pathname (Next.js-style)
// This lets router.pathname return "/[project]/messages" instead of "/my-project/messages"
const ROUTE_PATTERNS = [
  "/auth/signin",
  "/auth/signup",
  "/auth/error",
  "/admin",
  "/authorize",
  "/invite/accept",
  "/mcp/authorize",
  "/share/:id",
  "/onboarding",
  "/onboarding/:team/project",
  "/onboarding/product",
  "/onboarding/welcome",
  "/settings",
  "/settings/governance",
  "/settings/governance/ingestion-sources/:id",
  "/settings/governance/ingestion-sources",
  "/settings/governance/anomaly-rules",
  // Literal patterns for high-traffic /settings/* leafs that use
  // `router.push({ pathname: router.pathname, query: ... })` to update
  // their own filter state. Without these, the wildcard `/settings/*`
  // wins → resolves to `/settings/[[...path]]` → push leaves `path`
  // unresolved → URL bounces to `/settings/` (caught on /settings/audit-log
  // Filter-by-Action input during γ post-dogfood UI bug-bash, then again on
  // /settings/gateway/usage date presets and its key-filter chip).
  "/settings/audit-log",
  "/settings/gateway",
  "/settings/gateway/virtual-keys",
  "/settings/gateway/virtual-keys/:id",
  "/settings/gateway/budgets",
  "/settings/gateway/budgets/:id",
  "/settings/gateway/usage",
  "/settings/gateway/cache-rules",
  "/settings/gateway/guardrails",
  "/settings/*",
  // Personal-scope governance routes — must precede the "/:project/*" patterns
  // so the auto-detection in components/useWorkspaceCurrent doesn't classify
  // /me as a project page (which collapses the WorkspaceSwitcher to project
  // context and breaks the personal nav).
  "/me",
  "/me/configure",
  "/cli/auth",
  "/governance",
  "/:project/messages/:trace/:openTab/:span",
  "/:project/messages/:trace/:openTab",
  "/:project/messages/:trace",
  "/:project/messages",
  "/:project/traces/:trace",
  "/:project/traces",
  "/:project/analytics/custom/:id",
  "/:project/analytics/custom",
  "/:project/analytics/evaluations",
  "/:project/analytics/metrics",
  "/:project/analytics/reports",
  "/:project/analytics/topics",
  "/:project/analytics/users",
  "/:project/analytics",
  "/:project/annotations/all",
  "/:project/annotations/me",
  "/:project/annotations/my-queue",
  "/:project/annotations/:slug",
  "/:project/annotations",
  "/:project/evaluations/new/choose",
  "/:project/evaluations/new",
  "/:project/evaluations/wizard/:slug",
  "/:project/evaluations/wizard",
  "/:project/evaluations/:id/edit/choose",
  "/:project/evaluations/:id/edit",
  "/:project/evaluations",
  "/:project/online-evaluations",
  "/:project/experiments/workbench/:slug",
  "/:project/experiments/workbench",
  "/:project/experiments/:experiment",
  "/:project/experiments",
  "/:project/simulations/scenarios",
  "/:project/simulations/*",
  "/:project/simulations",
  "/:project/datasets/:id",
  "/:project/datasets",
  "/:project/evaluators",
  "/:project/agents",
  "/:project/automations",
  "/:project/prompts",
  "/:project/setup",
  "/:project/workflows",
  "/:project/chat/:workflow",
  "/:project/studio/:workflow",
  "/ops",
  "/ops/queues",
  "/ops/dejaview",
  "/ops/foundry",
  "/ops/projections",
  "/ops/projections/:runId",
  "/:project",
  "/",
];

/** @internal Exported for testing only */
export function resolvePathname(path: string): string {
  for (const pattern of ROUTE_PATTERNS) {
    if (matchPath(pattern, path)) {
      // Convert React Router params (:param) back to Next.js style ([param])
      return pattern
        .replace(/:(\w+)/g, "[$1]")
        .replace(/\/\*$/, "/[[...path]]");
    }
  }
  return path;
}

interface NextRouterOptions {
  shallow?: boolean;
  scroll?: boolean;
  locale?: string;
  // Forces the navigation's state update through ReactDOM.flushSync instead
  // of React Router's default startTransition wrap. Needed for navigations
  // that mount a first-time React.lazy() component (e.g. opening a drawer):
  // under startTransition, a Suspense boundary suspending for the first time
  // keeps the previously committed UI on screen instead of showing the
  // fallback, so the update appears to silently do nothing.
  flushSync?: boolean;
}

type EventHandler = (...args: any[]) => void;

// Simple event emitter for router.events compat (PostHog, activity tracking)
const routerEventListeners = new Map<string, Set<EventHandler>>();

const routerEvents = {
  on: (event: string, handler: EventHandler) => {
    if (!routerEventListeners.has(event)) {
      routerEventListeners.set(event, new Set());
    }
    routerEventListeners.get(event)!.add(handler);
  },
  off: (event: string, handler: EventHandler) => {
    routerEventListeners.get(event)?.delete(handler);
  },
  emit: (event: string, ...args: any[]) => {
    routerEventListeners.get(event)?.forEach((handler) => handler(...args));
  },
};

// Module-level dedup for routeChangeComplete. Without this, every mounted
// useRouter() instance (~120+) would emit the event independently, fanning
// each navigation out to N×listeners — which previously multiplied PostHog
// $pageview captures by the size of the React tree.
let _lastEmittedPath: string | null = null;
function emitRouteChangeOnce(path: string): void {
  if (_lastEmittedPath === path) return;
  _lastEmittedPath = path;
  routerEvents.emit("routeChangeComplete", path);
}

/**
 * Reset module-level dedup state. Test-only — production code never calls
 * this. Lets test files use a clean state without juggling vi.resetModules().
 *
 * @internal
 */
export function __resetRouteEmitDedupForTests(): void {
  _lastEmittedPath = null;
}

// Alias for code that imports `NextRouter` type from next/router
export type NextRouter = CompatRouter;

export interface CompatRouter {
  query: Record<string, string | string[] | undefined>;
  pathname: string;
  asPath: string;
  isReady: boolean;
  route: string;
  basePath: string;
  locale?: string;
  locales?: string[];
  defaultLocale?: string;
  events: typeof routerEvents;
  push: (
    url: string | { pathname?: string; query?: Record<string, any> },
    as?: string,
    options?: NextRouterOptions,
  ) => Promise<boolean>;
  replace: (
    url: string | { pathname?: string; query?: Record<string, any> },
    as?: string,
    options?: NextRouterOptions,
  ) => Promise<boolean>;
  back: () => void;
  reload: () => void;
  prefetch: (url: string) => Promise<void>;
  beforePopState: (cb: (state: any) => boolean) => void;
  isFallback: boolean;
}

// For query-only strings ("?foo=bar"), strip route param keys that
// leaked in from router.query spreads. Components do:
//   router.replace("?" + qs.stringify({ ...router.query, newKey: "val" }))
// which includes route params like `project` in the query string.
function stripRouteParamsFromQueryOnlyUrl({
  url,
  routeParamKeys,
  effectivePathname,
}: {
  url: string;
  routeParamKeys?: Set<string>;
  effectivePathname: string;
}): string {
  if (!url.startsWith("?") || !routeParamKeys?.size) return url;
  const searchParams = new URLSearchParams(url.slice(1));
  for (const key of routeParamKeys) {
    searchParams.delete(key);
  }
  const cleaned = searchParams.toString();
  return cleaned ? `?${cleaned}` : effectivePathname;
}

// Resolve Next.js-style [param] and [[...param]] in pathname using query values.
// Components do router.push({ pathname: router.pathname, query: {...} }) where
// router.pathname is "/[project]/messages". We need to replace [project] with
// the actual value from query before navigating.
function resolvePathPlaceholders(
  pathname: string,
  query: Record<string, any>,
  resolvedKeys: Set<string>,
): string {
  return pathname
    .replace(/\[\[\.\.\.(\w+)\]\]/g, (_match, key) => {
      resolvedKeys.add(key);
      const val = query[key];
      if (Array.isArray(val)) return val.join("/");
      return val != null ? String(val) : "";
    })
    .replace(/\[(\w+)\]/g, (_match, key) => {
      resolvedKeys.add(key);
      const val = query[key];
      return val != null ? String(Array.isArray(val) ? val[0] : val) : "";
    });
}

// Replace [param] placeholders in pathname with values from query.
// resolvePathname returns Next.js-style patterns like /[project]/analytics/custom/[id],
// but React Router needs the actual path segments.
function substituteRouteParams(
  pathname: string,
  query: Record<string, any>,
  routeParamKeys?: Set<string>,
): string {
  if (!routeParamKeys) return pathname;
  let substituted = pathname;
  for (const key of routeParamKeys) {
    const value = query[key];
    if (value !== undefined && value !== null) {
      substituted = substituted.replace(`[${key}]`, String(value));
    }
  }
  return substituted;
}

function appendQueryValue(
  params: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    for (const v of value) params.append(key, String(v));
  } else {
    params.set(key, String(value));
  }
}

function buildQueryString({
  query,
  routeParamKeys,
  resolvedKeys,
}: {
  query: Record<string, any>;
  routeParamKeys?: Set<string>;
  resolvedKeys: Set<string>;
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    // Skip route params and resolved [param] keys — they're in the URL path
    if (routeParamKeys?.has(key) || resolvedKeys.has(key)) continue;
    appendQueryValue(params, key, value);
  }
  return params.toString();
}

/** @internal Exported for testing only */
export function buildUrl(
  url: string | { pathname?: string; query?: Record<string, any> },
  routeParamKeys?: Set<string>,
  currentPathname?: string,
): string {
  // React Router's location is the source of truth in an SPA. Callers inside
  // the useRouter() hook pass it explicitly; other callers fall back to
  // window.location.pathname, which matches in BrowserRouter but is stale or
  // wrong under MemoryRouter / race conditions.
  const effectivePathname = currentPathname ?? window.location.pathname;
  if (typeof url === "string") {
    return stripRouteParamsFromQueryOnlyUrl({
      url,
      routeParamKeys,
      effectivePathname,
    });
  }
  // If pathname is omitted, use the current URL path (Next.js behavior)
  let pathname = url.pathname ?? effectivePathname;
  const { query } = url;

  const resolvedKeys = new Set<string>();
  if (query && pathname.includes("[")) {
    pathname = resolvePathPlaceholders(pathname, query, resolvedKeys);
  }

  if (!query || Object.keys(query).length === 0) return pathname;

  pathname = substituteRouteParams(pathname, query, routeParamKeys);

  const qs = buildQueryString({ query, routeParamKeys, resolvedKeys });
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Imperative Router singleton for use outside React components.
 * Mimics Next.js `Router` default export.
 * Must be kept in sync with the current URL state.
 */
type ImperativeRouter = {
  navigate: (
    to: string,
    opts?: { replace?: boolean; flushSync?: boolean },
  ) => void;
};

/**
 * Set by main.tsx after router is created. Enables imperative navigation
 * from module-level code (e.g. navigateToDrawer in useDrawer.ts).
 */
let _routerInstance: ImperativeRouter | null = null;
export function setRouterInstance(r: ImperativeRouter) {
  _routerInstance = r;
}

// A repeated key accumulates into an array, matching Next.js query semantics.
function mergeQueryValue(
  query: Record<string, string | string[] | undefined>,
  key: string,
  value: string,
): void {
  const existing = query[key];
  if (existing !== undefined) {
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[key] = [existing as string, value];
    }
  } else {
    query[key] = value;
  }
}

class RouterSingleton {
  get query(): Record<string, string | string[] | undefined> {
    const params = new URLSearchParams(window.location.search);
    const query: Record<string, string | string[] | undefined> = {};
    params.forEach((value, key) => {
      mergeQueryValue(query, key, value);
    });
    return query;
  }

  get pathname(): string {
    return resolvePathname(window.location.pathname);
  }

  get asPath(): string {
    return (
      window.location.pathname + window.location.search + window.location.hash
    );
  }

  get isReady(): boolean {
    return true;
  }

  push(
    url: string | { pathname?: string; query?: Record<string, any> },
    _as?: string,
    options?: NextRouterOptions,
  ): Promise<boolean> {
    const target = _as ?? buildUrl(url);
    if (_routerInstance) {
      _routerInstance.navigate(target, {
        replace: false,
        flushSync: options?.flushSync,
      });
    } else {
      window.history.pushState({}, "", target);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    if (options?.scroll !== false) {
      window.scrollTo(0, 0);
    }
    return Promise.resolve(true);
  }

  replace(
    url: string | { pathname?: string; query?: Record<string, any> },
    _as?: string,
    options?: NextRouterOptions,
  ): Promise<boolean> {
    const target = _as ?? buildUrl(url);
    if (_routerInstance) {
      _routerInstance.navigate(target, {
        replace: true,
        flushSync: options?.flushSync,
      });
    } else {
      window.history.replaceState({}, "", target);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    if (options?.scroll !== false) {
      window.scrollTo(0, 0);
    }
    return Promise.resolve(true);
  }

  back(): void {
    window.history.back();
  }

  reload(): void {
    window.location.reload();
  }

  get events() {
    return routerEvents;
  }
}

const Router = new RouterSingleton();
export default Router;

type RouteParams = Readonly<Record<string, string | undefined>>;

// Merge route params and search params into query object (Next.js style)
function routeParamsToQuery(
  params: RouteParams,
): Record<string, string | string[] | undefined> {
  const query: Record<string, string | string[] | undefined> = {
    ...params,
  };
  // Convert React Router catch-all (*) to Next.js-style array param (path)
  if (query["*"] !== undefined) {
    const catchAll = query["*"] as string;
    query.path = catchAll ? catchAll.split("/") : [];
    delete query["*"];
  }
  return query;
}

// Track which keys come from route params so we don't double-merge them.
// Include "path" (the renamed catch-all) so it's filtered from query strings.
function toRouteParamKeys(params: RouteParams): Set<string> {
  const keys = new Set(Object.keys(params));
  if (keys.has("*")) {
    keys.delete("*");
    keys.add("path");
  }
  return keys;
}

function mergeSearchParamsIntoQuery({
  query,
  searchParams,
  routeParamKeys,
}: {
  query: Record<string, string | string[] | undefined>;
  searchParams: URLSearchParams;
  routeParamKeys: Set<string>;
}): void {
  searchParams.forEach((value, key) => {
    // Skip search params that shadow route params — the route param
    // already has the canonical value. Without this guard, `project`
    // (a route param) leaks into the query string and accumulates
    // on every navigation (`project=x&project[0]=x&project[1]=x`).
    if (routeParamKeys.has(key)) return;
    mergeQueryValue(query, key, value);
  });
}

function toAsPath(location: {
  pathname?: string;
  search?: string;
  hash?: string;
}): string {
  return (
    (location.pathname ?? "/") +
    (location.search ? location.search : "") +
    (location.hash ? location.hash : "")
  );
}

export function useRouter(): CompatRouter {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [searchParams] = useSearchParams();

  // Fire routeChangeComplete exactly once per location change, not once per
  // useRouter() instance. The dedup is at module scope (emitRouteChangeOnce)
  // so the count is independent of how many components subscribe to useRouter.
  useEffect(() => {
    emitRouteChangeOnce(location.pathname + location.search);
  }, [location.pathname, location.search]);

  return useMemo(() => {
    const query = routeParamsToQuery(params);
    mergeSearchParamsIntoQuery({
      query,
      searchParams,
      routeParamKeys: toRouteParamKeys(params),
    });

    const pathname = resolvePathname(location.pathname) ?? location.pathname;
    const asPath = toAsPath(location);

    // Track which keys are route params (vs query string params).
    // Mirror the * → path rename so buildUrl filters "path" from query strings.
    const routeParamKeys = toRouteParamKeys(params);

    return {
      query,
      pathname,
      asPath,
      isReady: true,
      route: pathname,
      basePath: "",
      events: routerEvents,
      isFallback: false,
      push: (url, _as?, options?) => {
        // When `as` is provided (Next.js (url, as) overload), use it directly.
        // The `as` string is the actual browser URL; `url` is the internal route
        // descriptor which may contain [param] placeholders.
        const target = _as ?? buildUrl(url, routeParamKeys, location.pathname);
        void navigate(target, {
          replace: false,
          flushSync: options?.flushSync,
        });
        if (options?.scroll !== false) {
          window.scrollTo(0, 0);
        }
        return Promise.resolve(true);
      },
      replace: (url, _as?, options?) => {
        const target = _as ?? buildUrl(url, routeParamKeys, location.pathname);
        void navigate(target, { replace: true, flushSync: options?.flushSync });
        if (options?.scroll !== false) {
          window.scrollTo(0, 0);
        }
        return Promise.resolve(true);
      },
      back: () => navigate(-1),
      reload: () => window.location.reload(),
      prefetch: () => Promise.resolve(),
      beforePopState: () => undefined,
    };
  }, [navigate, location, params, searchParams]);
}
