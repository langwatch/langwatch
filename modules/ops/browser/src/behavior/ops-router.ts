/** Re-bind next-router through host port; both call shapes (string path, object
 * query) preserved. asPath includes fragment for Deja View workspace state. */

import { useMemo } from "react";

import { useOpsHost } from "../model/ops-host.ts";

export type OpsRouterTarget =
  | string
  /** Record<string, unknown> allows spreading then deleting keys; stringified below. */
  | { pathname?: string; query?: Record<string, unknown> };

export type OpsRouter = {
  query: Readonly<Record<string, string | undefined>>;
  asPath: string;
  push: (to: OpsRouterTarget) => void;
  replace: (to: OpsRouterTarget, as?: undefined, options?: { shallow?: boolean }) => void;
  back: () => void;
};

function queryOf(to: string): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  new URLSearchParams(to.startsWith("?") ? to.slice(1) : to).forEach((value, key) => {
    next[key] = value;
  });
  return next;
}

/** Everything a `{ query }` object states, as the strings a query string holds. */
function normalizeQuery(query: Record<string, unknown>): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === void 0) {
      next[key] = void 0;
      continue;
    }
    // An array repeats a key in a real query string; this reading is
    // single-valued, and the compat router's `query` bag was too by the time a
    // page read it back. First wins, which is what `new URLSearchParams` does.
    const first: unknown = Array.isArray(value) ? (value[0] ?? "") : value;
    next[key] = typeof first === "string" ? first : JSON.stringify(first);
  }
  return next;
}

type OpsHost = ReturnType<typeof useOpsHost>;

function pathWithQuery(pathname: string, query: Record<string, unknown> | undefined): string {
  if (!query) return pathname;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(normalizeQuery(query))) {
    if (value !== void 0) search.set(key, value);
  }
  const queryString = search.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

function go({ host, to, replace }: { host: OpsHost; to: OpsRouterTarget; replace: boolean }) {
  if (typeof to !== "string") {
    if (to.pathname !== void 0) host.navigate(pathWithQuery(to.pathname, to.query));
    else host.setQuery(normalizeQuery(to.query ?? {}), { replace });
    return;
  }
  if (to.startsWith("?")) host.setQuery(queryOf(to), { replace });
  else host.navigate(to);
}

export function useOpsRouter(): OpsRouter {
  const host = useOpsHost();
  const reading = host.route();
  const asPath = host.asPath();

  return useMemo(
    () => ({
      // Path parameters first, then the query string, exactly as the compat
      // router merged them: a `?id=` that shadows a `:id` segment never wins.
      query: { ...reading.query, ...reading.params },
      asPath,
      push: (to: OpsRouterTarget) => go({ host, to, replace: false }),
      replace: (to: OpsRouterTarget) => go({ host, to, replace: true }),
      back: () => host.navigate(".."),
    }),
    [host, reading, asPath],
  );
}
