/**
 * The router shape the moved studio modules already call.
 *
 * `platform/app` fakes a Next.js router over React Router
 * (`utils/compat/next-router`), and ninety-odd call sites in the studio's
 * closure read `router.query`, push an address or read `router.pathname`. None
 * of that may reach a router from a feature-web package, so the same shape is
 * answered here from the ONE port the family declares —
 * `WorkflowHostPort.route()` for the reading, `setQuery` for a query write and
 * `navigate` for an address.
 *
 * WHAT IS NARROWER THAN THE COMPAT SHIM, deliberately: `events`, `prefetch`,
 * `beforePopState` and the `(url, as, options)` triple are gone, because
 * nothing in this closure used them. `push`/`replace` take the one address a
 * caller passes; a bare query string (`"?a=1"`) is parsed and merged the way
 * the shim merged it, so `router.push("?" + qs.stringify(...))` keeps working.
 */

import { useMemo } from "react";

import { useWorkflowHost } from "../model/workflow-host";

export type StudioRouterQuery = Readonly<Record<string, string | undefined>>;

/**
 * The address a caller passes to `push`/`replace`.
 *
 * The Next.js router took either a string or a `{ pathname, query }` object,
 * and a third of the studio's navigations use the object form because they are
 * rewriting the query while staying on the page. Both are accepted here and
 * both end up as one address.
 */
export type StudioRouterTarget =
  | string
  | { pathname?: string; query?: Record<string, unknown>; hash?: string };

export type StudioRouter = {
  /** Path parameters and query string, merged the way the compat shim merged them. */
  query: StudioRouterQuery;
  /** The matched route path, e.g. `/:project/studio/:workflow`. */
  pathname: string;
  /** The address as the reader sees it, path plus query string. */
  asPath: string;
  route: string;
  isReady: boolean;
  push: (
    to: StudioRouterTarget,
    /** The Next.js router's second address, which nothing in this closure passes. */
    as?: string,
    options?: { shallow?: boolean; scroll?: boolean },
  ) => Promise<boolean>;
  replace: (
    to: StudioRouterTarget,
    /** The Next.js router's second address, which nothing in this closure passes. */
    as?: string,
    options?: { shallow?: boolean; scroll?: boolean },
  ) => Promise<boolean>;
  back: () => void;
};

/** Splits `"/a/b?x=1#y"` into its three parts, hash included. */
function splitAddress(to: string): { path: string; query: string; hash: string } {
  const [beforeHash = "", ...hashRest] = to.split("#");
  const hash = hashRest.length > 0 ? `#${hashRest.join("#")}` : "";
  const questionMark = beforeHash.indexOf("?");
  if (questionMark === -1) return { path: beforeHash, query: "", hash };
  return {
    path: beforeHash.slice(0, questionMark),
    query: beforeHash.slice(questionMark + 1),
    hash,
  };
}

function parseQuery(queryString: string): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!queryString) return out;
  for (const [key, value] of new URLSearchParams(queryString).entries()) out[key] = value;
  return out;
}

/** Renders the object form of an address as the string form of it. */
function asAddress(to: StudioRouterTarget, currentPathname: string): string {
  if (typeof to === "string") return to;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(to.query ?? {})) {
    if (value === void 0 || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.set(key, String(value));
    }
  }
  const encoded = params.toString();
  const pathname = to.pathname ?? "";
  // A pathname equal to the one already open is a query rewrite, not a
  // navigation: leaving it in would make every filter change a page change.
  const path = pathname === currentPathname ? "" : pathname;
  return `${path}${encoded ? `?${encoded}` : ""}${to.hash ?? ""}`;
}

function stringifyQuery(query: StudioRouterQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== void 0) params.set(key, value);
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * The router the studio's modules read.
 *
 * A push whose address is only a query string never leaves the page: it is a
 * whole-query write, which is what `UiRoutePort.setQuery` takes. An address
 * with a path is a navigation.
 */
export function useRouter(): StudioRouter {
  const host = useWorkflowHost();
  const reading = host.route();

  return useMemo(() => {
    const query: StudioRouterQuery = { ...reading.params, ...reading.query };
    const asPath = `${reading.pathname ?? ""}${stringifyQuery(reading.query)}`;

    const go = (target: StudioRouterTarget, options?: { replace?: boolean }) => {
      const to = asAddress(target, reading.pathname ?? "");
      const { path, query: queryString } = splitAddress(to);
      if (path) {
        host.navigate(to);
        return Promise.resolve(true);
      }
      host.setQuery(parseQuery(queryString), { replace: options?.replace ?? false });
      return Promise.resolve(true);
    };

    return {
      query,
      pathname: reading.pathname ?? "",
      route: reading.pathname ?? "",
      asPath,
      isReady: true,
      push: (to: StudioRouterTarget) => go(to),
      replace: (to: StudioRouterTarget) => go(to, { replace: true }),
      back: () => host.back(),
    };
  }, [host, reading]);
}

/**
 * The module-scope router the compat shim also published.
 *
 * `platform/app` kept a singleton so code that is not a component could push an
 * address. The studio's closure uses it in exactly one place — the drawer
 * navigation below — and it is answered by whichever host is currently mounted.
 */
export const studioRouterRef: { current: StudioRouter | undefined } = { current: void 0 };

export default studioRouterRef;
