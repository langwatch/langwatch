/**
 * `useRouter`, once, for every browser feature that still spells it that way.
 *
 * Seven packages carried their own shim over their own feature host port, each
 * one a slightly different reading of the same address. That is the scope
 * hook's fault again: a component one family lends to another read a router
 * that only the lending family's routes mount. So the address is asked of the
 * two ports the application publishes — `UiRoutePort` for the reading,
 * `UiNavigationPort` for the move — and any screen may ask it.
 *
 * ABSENT IS A READING, NOT A CRASH. With no capabilities above it the hook
 * answers an empty address whose `push` does nothing and whose `isReady` is
 * false, which is what `isReady` is for.
 *
 * `query` MERGES THE PATH PARAMETERS OVER THE QUERY STRING, which is what the
 * Next router these call sites were written against did. `params` and `search`
 * are also published apart, for a caller that means one of them exactly.
 */

import { useMemo } from "react";

import { useOptionalUiCapabilities } from "./capabilities";

export type UiRouterValues = Readonly<Record<string, string | undefined>>;

/**
 * An address, in either form the Next router took.
 *
 * A third of the navigations pass the object form because they are rewriting
 * the query while staying on the page, so both are accepted and both end up as
 * one address.
 */
export type UiRouterTarget =
  | string
  | { pathname?: string; query?: Record<string, unknown>; hash?: string };

export type UiRouter = {
  /** Path parameters over the query string, as one bag. */
  query: UiRouterValues;
  /** The `:id` style segments the matched route captured, alone. */
  params: UiRouterValues;
  /** The query string, alone. */
  search: UiRouterValues;
  /** The path the reader is on, without query or fragment. */
  pathname: string;
  /** The same value under the name the Next router published it as. */
  route: string;
  /** Path plus query string, as the reader sees it. */
  asPath: string;
  /** False only when nothing published an address at all. */
  isReady: boolean;
  push: (
    to: UiRouterTarget,
    /** The Next router's second address, which no call site passes. */
    as?: unknown,
    options?: { replace?: boolean; shallow?: boolean; scroll?: boolean },
  ) => Promise<boolean>;
  replace: (
    to: UiRouterTarget,
    as?: unknown,
    options?: { replace?: boolean; shallow?: boolean; scroll?: boolean },
  ) => Promise<boolean>;
  back: () => void;
};

const NO_VALUES: UiRouterValues = {};

const NO_ROUTER: UiRouter = {
  query: NO_VALUES,
  params: NO_VALUES,
  search: NO_VALUES,
  pathname: "",
  route: "",
  asPath: "",
  isReady: false,
  push: () => Promise.resolve(false),
  replace: () => Promise.resolve(false),
  back: () => {},
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
  const parsed: Record<string, string | undefined> = {};
  if (!queryString) return parsed;
  for (const [key, value] of new URLSearchParams(queryString).entries()) parsed[key] = value;
  return parsed;
}

function stringifyQuery(query: UiRouterValues): string {
  const written = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== void 0) written.set(key, value);
  }
  const encoded = written.toString();
  return encoded ? `?${encoded}` : "";
}

/** Renders the object form of an address as the string form of it. */
function asAddress(to: UiRouterTarget, currentPathname: string): string {
  if (typeof to === "string") return to;
  const written = new URLSearchParams();
  for (const [key, value] of Object.entries(to.query ?? {})) {
    if (value === void 0 || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) written.append(key, String(entry));
    } else {
      written.set(key, String(value));
    }
  }
  const encoded = written.toString();
  const pathname = to.pathname ?? "";
  // A pathname equal to the one already open is a query rewrite, not a
  // navigation: leaving it in would make every filter change a page change.
  const path = pathname === currentPathname ? "" : pathname;
  return `${path}${encoded ? `?${encoded}` : ""}${to.hash ?? ""}`;
}

/**
 * The address this screen is rendering, and the two ways off it.
 *
 * A push whose address is only a query string never leaves the page: it is a
 * whole-query write, which is what `UiRoutePort.setQuery` takes. An address
 * with a path is a navigation.
 */
export function useRouter(): UiRouter {
  const capabilities = useOptionalUiCapabilities();

  return useMemo(() => {
    if (!capabilities) return NO_ROUTER;
    const { route, navigation } = capabilities;
    const reading = route.reading();
    const pathname = reading.pathname ?? "";

    const go = (target: UiRouterTarget, options?: { replace?: boolean }) => {
      const to = asAddress(target, pathname);
      const { path, query: queryString } = splitAddress(to);
      if (path) {
        if (options?.replace) navigation.replace(to);
        else navigation.navigate(to);
        return Promise.resolve(true);
      }
      route.setQuery(parseQuery(queryString), { replace: options?.replace ?? false });
      return Promise.resolve(true);
    };

    return {
      query: { ...reading.query, ...reading.params },
      params: reading.params,
      search: reading.query,
      pathname,
      route: pathname,
      asPath: `${pathname}${stringifyQuery(reading.query)}`,
      isReady: true,
      push: (to: UiRouterTarget, _as?: unknown, options?: { replace?: boolean }) => go(to, options),
      replace: (to: UiRouterTarget) => go(to, { replace: true }),
      back: () => navigation.back(),
    };
  }, [capabilities]);
}
