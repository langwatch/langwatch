/**
 * The address, as the drawer navigator reads and writes it.
 *
 * `platform/app` drove every drawer navigation through
 * `~/utils/compat/next-router` — a Next.js router faked over React Router, with
 * a `push(url, as, { shallow, flushSync })` signature and a `query` that merges
 * route params with the search string. That module is the application's and has
 * no package export, so this is the one seam of the drawer half that is
 * redesigned rather than moved: the same three facts (`query`, `asPath`, a
 * push/replace of one address) read straight off `react-router`.
 *
 * WHAT SURVIVES THE NARROWING. `shallow` was always true and means nothing
 * outside Next; a client router never leaves the page. `flushSync` was
 * load-bearing for a different reason and is kept below.
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
 * The router the last mounted `useDrawer` was inside.
 *
 * `platform/app` kept a module-scope `Router` singleton so code that is not a
 * component could push an address; `navigateToDrawer` is the one caller that
 * needs it. Answered by whichever navigator is currently mounted.
 */
export const drawerRouterRef: { current: DrawerRouter | undefined } = { current: void 0 };

/** Query keys parsed flat, the way `next/router` published them. */
export function readFlatQuery(search: string): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {};
  for (const [key, value] of new URLSearchParams(search).entries()) query[key] = value;
  return query;
}

/**
 * Make a query-only or hash-only address absolute.
 *
 * `openDrawer` and friends build `"?" + qs.stringify(...)`. React Router
 * resolves a bare search string against the current route rather than the
 * current URL, which drops the path on a splat route, so the path is stated.
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
        // The Next shim's `flushSync` is gone with the shim, and what it was
        // for is not: drawers are `lazy()`, so this update mounts one for the
        // first time more often than not, and under a transition a first-time
        // Suspense keeps the previously committed UI on screen instead of the
        // fallback. React Router 8 wraps navigations in `startTransition` only
        // when its own future flag asks for it, and this application does not,
        // so a plain navigate commits synchronously and the fallback paints.
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
