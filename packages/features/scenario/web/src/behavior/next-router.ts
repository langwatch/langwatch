/**
 * `useRouter`, as this package still spells it.
 *
 * `~/utils/compat/next-router` is the application's shim over react-router, and
 * ADR-004 seals react-router off from a feature package. Nineteen call sites
 * read `query`, `pathname` and `isReady` and push or replace one address; all
 * of that is on the host port already, so this is an adapter and not a router.
 *
 * `query` MERGES the path parameters over the query string, which is what the
 * Next shim published and what the simulations catch-all reads: `router.query.path`
 * is the splat and `router.query.project` the project slug, both path
 * parameters, while `?batchId=` is a query key.
 *
 * `push` takes the Next signature (`url, as, options`) because that is what the
 * call sites pass; only the first argument is used, which is all any of them
 * ever varied.
 */

import { useMemo } from "react";

import { useScenarioHost } from "../model/scenario-host";

/**
 * An address, in either form the Next router took.
 *
 * Nine call sites push a string; three push `{ pathname?, query }`, which is
 * how the Next router let a caller rewrite the query without rebuilding the
 * path. Both are kept, because rewriting those three would have been the only
 * edit this shim exists to avoid.
 */
export type ScenarioCompatUrl =
  | string
  | {
      pathname?: string;
      query?: Record<string, string | string[] | undefined>;
    };

export type ScenarioCompatRouter = {
  query: Readonly<Record<string, string | string[] | undefined>>;
  pathname: string;
  route: string;
  asPath: string;
  isReady: boolean;
  push: (
    url: ScenarioCompatUrl,
    as?: unknown,
    options?: { replace?: boolean; shallow?: boolean },
  ) => void;
  replace: (
    url: ScenarioCompatUrl,
    as?: unknown,
    options?: { replace?: boolean; shallow?: boolean },
  ) => void;
};

/** The object form, flattened into the address a navigation takes. */
function toAddress(url: ScenarioCompatUrl, currentPathname: string): string {
  if (typeof url === "string") return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(url.query ?? {})) {
    if (value === void 0) continue;
    if (Array.isArray(value)) {
      for (const entry of value) search.append(key, entry);
    } else {
      search.set(key, value);
    }
  }
  const queryString = search.toString();
  const path = url.pathname ?? currentPathname;
  return queryString ? `${path}?${queryString}` : path;
}

export function useRouter(): ScenarioCompatRouter {
  const host = useScenarioHost();
  const reading = host.route();
  return useMemo(() => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(reading.query)) {
      if (value !== void 0) search.set(key, value);
    }
    const queryString = search.toString();
    return {
      query: { ...reading.query, ...reading.params },
      pathname: reading.pathname,
      route: reading.pathname,
      asPath: queryString ? `${reading.pathname}?${queryString}` : reading.pathname,
      isReady: true,
      push: (url: ScenarioCompatUrl) => host.navigate(toAddress(url, reading.pathname)),
      replace: (url: ScenarioCompatUrl) =>
        host.navigate(toAddress(url, reading.pathname), { replace: true }),
    };
  }, [host, reading]);
}

export default { push: (url: ScenarioCompatUrl) => void url };
