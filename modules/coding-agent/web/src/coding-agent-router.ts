/** Address as activity tables read/write it; re-bound to host with expected shape. */

import { useMemo } from "react";
import { useCodingAgentActivityHost } from "./coding-agent-activity-host.ts";

export type CodingAgentRouter = {
  query: Readonly<Record<string, string | undefined>>;
  push: (to: string) => void;
  replace: (to: string) => void;
  /** Merge keys into address; undefined removes key. Keeps drawer and replay state separate. */
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
