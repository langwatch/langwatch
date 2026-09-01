/**
 * The address, as the Ops surfaces read and write it.
 *
 * They arrived using `~/utils/compat/next-router`'s `useRouter` (path
 * parameters and the query string merged into one `query` bag), which is a
 * router import a feature-web package may not make, so it is re-bound to the
 * host's route capability with the shape the call sites already expect.
 *
 * Both call shapes the Ops surfaces actually use are carried: a plain path
 * string (`router.push("/ops/projections/run_1")`) navigates, and the compat
 * router's OBJECT form (`router.replace({ query }, undefined, { shallow })`)
 * rewrites the query of the current page. The two backoffice tables use the
 * object form to keep an opened row in the address, so dropping it would have
 * silently stopped their deep links working.
 *
 * `asPath` is the whole address INCLUDING the fragment, because Deja View keeps
 * its entire workspace state there. It is the one reading the host has to
 * supply beyond params and query, and it is why `OpsHostPort.asPath` exists.
 */

import { useMemo } from "react";
import { useOpsHost } from "../model/ops-host";

export type OpsRouterTarget =
  | string
  /**
   * `Record<string, unknown>` rather than a string-ish union, because the two
   * backoffice tables build their next query by spreading `router.query` — which
   * the compat router typed as `string | string[] | undefined` — and then
   * deleting a key off it. Anything that is not a string is stringified below,
   * which is what `buildUrl` did.
   */
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
    next[key] = Array.isArray(value) ? String(value[0] ?? "") : String(value);
  }
  return next;
}

export function useOpsRouter(): OpsRouter {
  const host = useOpsHost();
  const reading = host.route();
  const asPath = host.asPath();

  return useMemo(() => {
    const go = (to: OpsRouterTarget, replace: boolean) => {
      if (typeof to === "string") {
        if (to.startsWith("?")) {
          host.setQuery(queryOf(to), { replace });
          return;
        }
        host.navigate(to);
        return;
      }
      if (to.pathname !== void 0) {
        const search = to.query ? new URLSearchParams() : null;
        if (search && to.query) {
          for (const [key, value] of Object.entries(normalizeQuery(to.query))) {
            if (value !== void 0) search.set(key, value);
          }
        }
        const suffix = search && search.toString() ? `?${search.toString()}` : "";
        host.navigate(`${to.pathname}${suffix}`);
        return;
      }
      host.setQuery(normalizeQuery(to.query ?? {}), { replace });
    };
    return {
      // Path parameters first, then the query string, exactly as the compat
      // router merged them: a `?id=` that shadows a `:id` segment never wins.
      query: { ...reading.query, ...reading.params },
      asPath,
      push: (to: OpsRouterTarget) => go(to, false),
      replace: (to: OpsRouterTarget) => go(to, true),
      back: () => host.navigate(".."),
    };
  }, [host, reading, asPath]);
}
