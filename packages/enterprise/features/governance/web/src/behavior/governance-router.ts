/**
 * The address, as the governance screens read and write it.
 *
 * They arrived using `~/utils/compat/next-router`'s `useRouter` (path
 * parameters and the query string merged into one `query` bag) and, in one
 * place, `react-router`'s `useSearchParams`. Both are router imports a
 * feature-web package may not make, so both are re-bound to the host's route
 * capability with the shapes the call sites already expect.
 *
 * `push` and `replace` take the same strings the pages pass today: an absolute
 * path navigates, and a bare `"?a=b"` rewrites the query of the current page.
 */

import { useCallback, useMemo } from "react";
import { useGovernanceHost } from "../model/governance-host";

export type GovernanceRouter = {
  query: Readonly<Record<string, string | undefined>>;
  push: (to: string) => void;
  replace: (to: string) => void;
};

function queryOf(to: string): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  new URLSearchParams(to.startsWith("?") ? to.slice(1) : to).forEach((value, key) => {
    next[key] = value;
  });
  return next;
}

export function useGovernanceRouter(): GovernanceRouter {
  const host = useGovernanceHost();
  const reading = host.route();

  return useMemo(() => {
    const go = (to: string, replace: boolean) => {
      if (to.startsWith("?")) {
        host.setQuery(queryOf(to), { replace });
        return;
      }
      host.navigate(to);
    };
    return {
      // Path parameters first, then the query string, exactly as the compat
      // router merged them: a `?id=` that shadows a `:id` segment never wins.
      query: { ...reading.query, ...reading.params },
      push: (to: string) => go(to, false),
      replace: (to: string) => go(to, true),
    };
  }, [host, reading]);
}

/**
 * `useSearchParams`, over the host reading rather than the router.
 *
 * The setter takes react-router's two forms — the next params, or a function
 * handed the current ones — because the call sites use both.
 */
export type GovernanceSearchParamsUpdate =
  | URLSearchParams
  | ((current: URLSearchParams) => URLSearchParams);

export function useGovernanceSearchParams(): [
  URLSearchParams,
  (next: GovernanceSearchParamsUpdate, options?: { replace?: boolean }) => void,
] {
  const host = useGovernanceHost();
  const reading = host.route();

  const searchParams = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(reading.query)) {
      if (value !== void 0) params.set(key, value);
    }
    return params;
  }, [reading.query]);

  const setSearchParams = useCallback(
    (next: GovernanceSearchParamsUpdate, options?: { replace?: boolean }) => {
      const resolved = typeof next === "function" ? next(new URLSearchParams(searchParams)) : next;
      const written: Record<string, string | undefined> = {};
      resolved.forEach((value, key) => {
        written[key] = value;
      });
      host.setQuery(written, options ?? {});
    },
    [host, searchParams],
  );

  return [searchParams, setSearchParams];
}
