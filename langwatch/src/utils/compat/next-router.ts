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
import { useEffect, useMemo, useRef } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
  matchPath,
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
  "/settings/*",
  "/:project/messages/:trace/:openTab/:span",
  "/:project/messages/:trace/:openTab",
  "/:project/messages/:trace",
  "/:project/messages",
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
    options?: NextRouterOptions
  ) => Promise<boolean>;
  replace: (
    url: string | { pathname?: string; query?: Record<string, any> },
    as?: string,
    options?: NextRouterOptions
  ) => Promise<boolean>;
  back: () => void;
  reload: () => void;
  prefetch: (url: string) => Promise<void>;
  beforePopState: (cb: (state: any) => boolean) => void;
  isFallback: boolean;
}

/** @internal Exported for testing only */
export function buildUrl(
  url: string | { pathname?: string; query?: Record<string, any> },
  routeParamKeys?: Set<string>
): string {
  if (typeof url === "string") {
    // For query-only strings ("?foo=bar"), strip route param keys that
    // leaked in from router.query spreads. Components do:
    //   router.replace("?" + qs.stringify({ ...router.query, newKey: "val" }))
    // which includes route params like `project` in the query string.
    if (url.startsWith("?") && routeParamKeys?.size) {
      const searchParams = new URLSearchParams(url.slice(1));
      for (const key of routeParamKeys) {
        searchParams.delete(key);
      }
      const cleaned = searchParams.toString();
      return cleaned ? `?${cleaned}` : window.location.pathname;
    }
    return url;
  }
  // If pathname is omitted, use the current URL path (Next.js behavior)
  let pathname = url.pathname ?? window.location.pathname;
  const { query } = url;

  // Resolve Next.js-style [param] and [[...param]] in pathname using query values.
  // Components do router.push({ pathname: router.pathname, query: {...} }) where
  // router.pathname is "/[project]/messages". We need to replace [project] with
  // the actual value from query before navigating.
  const resolvedKeys = new Set<string>();
  if (query && pathname.includes("[")) {
    pathname = pathname
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

  if (!query || Object.keys(query).length === 0) return pathname;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    // Skip route params and resolved [param] keys — they're in the URL path
    if (routeParamKeys?.has(key) || resolvedKeys.has(key)) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Imperative Router singleton for use outside React components.
 * Mimics Next.js `Router` default export.
 * Must be kept in sync with the current URL state.
 */
/**
 * Set by main.tsx after router is created. Enables imperative navigation
 * from module-level code (e.g. navigateToDrawer in useDrawer.ts).
 */
let _routerInstance: { navigate: (to: string) => void } | null = null;
export function setRouterInstance(r: { navigate: (to: string) => void }) {
  _routerInstance = r;
}

class RouterSingleton {
  get query(): Record<string, string | string[] | undefined> {
    const params = new URLSearchParams(window.location.search);
    const query: Record<string, string | string[] | undefined> = {};
    params.forEach((value, key) => {
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
    });
    return query;
  }

  get pathname(): string {
    return resolvePathname(window.location.pathname);
  }

  get asPath(): string {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  get isReady(): boolean {
    return true;
  }

  push(
    url: string | { pathname?: string; query?: Record<string, any> },
    _as?: string,
    options?: NextRouterOptions
  ): Promise<boolean> {
    const target = buildUrl(url);
    if (_routerInstance) {
      _routerInstance.navigate(target);
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
    options?: NextRouterOptions
  ): Promise<boolean> {
    const target = buildUrl(url);
    if (_routerInstance) {
      _routerInstance.navigate(target);
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

export function useRouter(): CompatRouter {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [searchParams] = useSearchParams();

  // Fire routeChangeComplete when location changes (for PostHog, activity tracking)
  const prevPathRef = useRef(location.pathname + location.search);
  useEffect(() => {
    const currentPath = location.pathname + location.search;
    if (prevPathRef.current !== currentPath) {
      prevPathRef.current = currentPath;
      routerEvents.emit("routeChangeComplete", currentPath);
    }
  }, [location.pathname, location.search]);

  return useMemo(() => {
    // Merge route params and search params into query object (Next.js style)
    const query: Record<string, string | string[] | undefined> = {
      ...params,
    };
    // Convert React Router catch-all (*) to Next.js-style array param (path)
    if (query["*"] !== undefined) {
      const catchAll = query["*"] as string;
      query.path = catchAll ? catchAll.split("/") : [];
      delete query["*"];
    }
    // Track which keys come from route params so we don't double-merge them
    const routeParamKeySet = new Set(Object.keys(params));
    searchParams.forEach((value, key) => {
      // Skip search params that shadow route params — the route param
      // already has the canonical value. Without this guard, `project`
      // (a route param) leaks into the query string and accumulates
      // on every navigation (`project=x&project[0]=x&project[1]=x`).
      if (routeParamKeySet.has(key)) return;
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
    });

    const pathname = resolvePathname(location.pathname) ?? location.pathname;
    const asPath =
      (location.pathname ?? "/") +
      (location.search ? location.search : "") +
      (location.hash ? location.hash : "");

    // Track which keys are route params (vs query string params)
    const routeParamKeys = new Set(Object.keys(params));

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
        const target = buildUrl(url, routeParamKeys);
        navigate(target, { replace: false });
        if (options?.scroll !== false) {
          window.scrollTo(0, 0);
        }
        return Promise.resolve(true);
      },
      replace: (url, _as?, options?) => {
        const target = buildUrl(url, routeParamKeys);
        navigate(target, { replace: true });
        if (options?.scroll !== false) {
          window.scrollTo(0, 0);
        }
        return Promise.resolve(true);
      },
      back: () => navigate(-1),
      reload: () => window.location.reload(),
      prefetch: () => Promise.resolve(),
      beforePopState: () => {},
    };
  }, [navigate, location, params, searchParams]);
}
