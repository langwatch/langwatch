/**
 * The address, as the activity tables read and write it.
 *
 * They arrived using `platform/app`'s `~/utils/compat/next-router` (path
 * parameters and the query string merged into one `query` bag), which is a
 * router import a feature-web package may not make, so it is re-bound to the
 * host with the shape the call sites already expect.
 *
 * `push` and `replace` take the same strings the tables passed: an absolute
 * path navigates, and a bare `"?a=b"` rewrites the query of the current page.
 */

import { useMemo } from "react";
import { useCodingAgentActivityHost } from "./coding-agent-activity-host";

export type CodingAgentRouter = {
  query: Readonly<Record<string, string | undefined>>;
  push: (to: string) => void;
  replace: (to: string) => void;
  /**
   * Merges keys into the address, leaving the rest of it alone; a key set to
   * `undefined` is removed.
   *
   * The port's `setQuery` takes the WHOLE next query, and these tables put two
   * unrelated things in it — which pull request the detail drawer is open on,
   * and which trace the terminal replay opened. Replacing the whole query to
   * write one of them would take the other off, which is the drawer-stack
   * behaviour `platform/app`'s registry had and this keeps.
   */
  setQueryParams: (
    patch: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
};

function queryOf(to: string): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  new URLSearchParams(to.startsWith("?") ? to.slice(1) : to).forEach((value, key) => {
    next[key] = value;
  });
  return next;
}

export function useCodingAgentRouter(): CodingAgentRouter {
  const host = useCodingAgentActivityHost();
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
      setQueryParams: (patch, options) => host.setQuery({ ...reading.query, ...patch }, options),
    };
  }, [host, reading]);
}
