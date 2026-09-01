/**
 * The address, as the personal-workspace screens read and write it.
 *
 * They arrived using `platform/app`'s `~/utils/compat/next-router` (path
 * parameters and the query string merged into one `query` bag) and, on the
 * settings screen, `react-router`'s `useSearchParams`. Both are router imports
 * a feature-web package may not make, so they are re-bound to the host's route
 * capability with the shape the call sites already expect.
 *
 * `push` and `replace` take the same strings the pages passed: an absolute path
 * navigates, and a bare `"?a=b"` rewrites the query of the current page.
 */

import { useMemo } from "react";
import { usePersonalWorkspaceHost } from "../model/personal-workspace-host";

export type PersonalRouter = {
  query: Readonly<Record<string, string | undefined>>;
  push: (to: string) => void;
  replace: (to: string) => void;
  /** Sets or removes one query key, leaving the rest of the address alone. */
  setQueryParam: (key: string, value: string | undefined, options?: { replace?: boolean }) => void;
};

function queryOf(to: string): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  new URLSearchParams(to.startsWith("?") ? to.slice(1) : to).forEach((value, key) => {
    next[key] = value;
  });
  return next;
}

export function usePersonalRouter(): PersonalRouter {
  const host = usePersonalWorkspaceHost();
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
      setQueryParam: (key, value, options) =>
        host.setQuery({ ...reading.query, [key]: value }, options),
    };
  }, [host, reading]);
}
