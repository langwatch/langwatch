/**
 * Drawer navigator address abstraction over react-router.
 * Provides query/asPath interface from the Next.js faked router.
 */

import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

/** The three facts the navigator needs, and the one write it makes. */
export type DrawerRouter = {
  /** Flat query keys, `drawer.open` included — the shape the shim published. */
  readonly query: Readonly<Record<string, string | undefined>>;
  /** Path + query + hash, as the reader sees it. */
  readonly asPath: string;
  /** The path alone, so a query-only address can be made absolute. */
  readonly pathname: string;
  push: (url: string, options?: { replace?: boolean }) => void;
};

/**
 * The router the last mounted `useDrawer` was inside. `platform/app` kept a
 * module-scope `Router` singleton so non-component code could push an
 * address; `navigateToDrawer` is the one caller that still needs it.
 */
export const drawerRouterRef: { current: DrawerRouter | undefined } = { current: void 0 };

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
    return {
      query: readFlatQuery(location.search),
      asPath: `${pathname}${location.search}${location.hash}`,
      pathname,
      push: (url, options) => {
        // Drawers are `lazy()`, so this often mounts one for the first time.
        // Under a transition, first-time Suspense keeps the old UI on screen
        // instead of the fallback. React Router 8 only wraps navigation in
        // `startTransition` behind its own flag, unset here, so this commits
        // synchronously and the fallback paints.
        void navigate(absoluteDrawerAddress(url, pathname), {
          replace: options?.replace ?? false,
        });
      },
    };
  }, [location.pathname, location.search, location.hash, navigate]);

  useEffect(() => {
    drawerRouterRef.current = router;
  }, [router]);

  return router;
}
