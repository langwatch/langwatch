/**
 * The drawer navigator's view of the SPA's react-router location: a flat
 * query, the full address and one push.
 */

import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

/** The facts the navigator needs, and the one write it makes. */
export type DrawerRouter = {
  /** Flat query keys, `drawer.open` included — the shape the shim published. */
  readonly query: Readonly<Record<string, string | undefined>>;
  /** Path + query + hash, as the reader sees it. */
  readonly asPath: string;
  /** The path alone, so a query-only address can be made absolute. */
  readonly pathname: string;
  /** The location's `state`: where the drawers beneath the open one ride. */
  readonly state: unknown;
  push: (url: string, options?: { replace?: boolean; state?: unknown }) => void;
};

/**
 * The router the last mounted `useDrawer` was inside, moved on by each write it
 * makes so a second write in the same tick builds on the first. Module-level
 * code (outside any component) opens drawers through it.
 */
export const drawerRouterRef: { current: DrawerRouter | undefined } = { current: void 0 };

/** Every router a mounted component registered, oldest first; each takes only itself back. */
const mounted = new Set<DrawerRouter>();

function latestMounted(): DrawerRouter | undefined {
  return [...mounted].at(-1);
}

/**
 * What the mounted navigator sees, for code outside a component; the address bar when none is
 * mounted.
 */
export function readDrawerLocation(): Pick<DrawerRouter, "query" | "state" | "asPath"> {
  const router = drawerRouterRef.current;
  if (router) return { query: router.query, state: router.state, asPath: router.asPath };
  if (typeof window === "undefined") return { query: {}, state: null, asPath: "" };
  const { pathname, search, hash } = window.location;
  return {
    query: readFlatQuery(search),
    state: window.history.state?.usr,
    asPath: `${pathname}${search}${hash}`,
  };
}

/** Whether the address bar already reads `router`'s address: its navigation landed. */
function addressBarShows(router: DrawerRouter): boolean {
  if (typeof window === "undefined") return false;
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}` === router.asPath;
}

/** The router as it will read once a push to `url` lands. */
function routerAfterPush({
  router,
  url,
  state,
}: {
  router: DrawerRouter;
  url: string;
  state: unknown;
}): DrawerRouter {
  const target = new URL(absoluteDrawerAddress(url, router.pathname), "http://drawer.invalid");
  return {
    ...router,
    pathname: target.pathname,
    query: readFlatQuery(target.search),
    asPath: `${target.pathname}${target.search}${target.hash}`,
    state: state ?? null,
  };
}

/** Query keys parsed flat, the way `next/router` published them. */
export function readFlatQuery(search: string): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {};
  for (const [key, value] of new URLSearchParams(search).entries()) query[key] = value;
  return query;
}

/**
 * Make a query-only or hash-only address absolute. `openDrawer` and friends
 * build `"?" + qs.stringify(...)`; React Router resolves a bare search
 * string against the route, not the URL, dropping the path on a splat route.
 */
export function absoluteDrawerAddress(url: string, pathname: string): string {
  if (url.startsWith("?") || url.startsWith("#")) return `${pathname}${url}`;
  return url;
}

/** The drawer navigator's view of the router it is mounted inside. */
export function useDrawerRouter(): DrawerRouter {
  const location = useLocation();
  const navigate = useNavigate();

  const router = useMemo<DrawerRouter>(() => {
    const pathname = location.pathname;
    const self: DrawerRouter = {
      query: readFlatQuery(location.search),
      asPath: `${pathname}${location.search}${location.hash}`,
      pathname,
      state: location.state,
      push: (url, options) => {
        // Drawers are `lazy()`, so this often mounts one for the first time.
        // Under a transition, first-time Suspense keeps the old UI on screen
        // instead of the fallback. React Router 8 only wraps navigation in
        // `startTransition` behind its own flag, unset here, so this commits
        // synchronously and the fallback paints.
        const settled = navigate(absoluteDrawerAddress(url, pathname), {
          replace: options?.replace ?? false,
          state: options?.state,
        });
        const mirror = routerAfterPush({ router: self, url, state: options?.state });
        drawerRouterRef.current = mirror;
        // A blocked or redirected navigation leaves the address bar off the mirror, so the mirror
        // is handed back here; a landed one stays until its re-render registers the new router.
        void Promise.resolve(settled).finally(() => {
          if (drawerRouterRef.current !== mirror || addressBarShows(mirror)) return;
          drawerRouterRef.current = latestMounted();
        });
      },
    };
    return self;
  }, [location.pathname, location.search, location.hash, location.state, navigate]);

  useEffect(() => {
    mounted.add(router);
    drawerRouterRef.current = router;
    return () => {
      mounted.delete(router);
      if (mounted.size === 0) drawerRouterRef.current = undefined;
      else if (drawerRouterRef.current === router) drawerRouterRef.current = latestMounted();
    };
  }, [router]);

  return router;
}
