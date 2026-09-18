/** Router for personal-workspace screens, bound through host's route capability. */

import { useMemo } from "react";
import { usePersonalWorkspaceHost } from "../model/personal-workspace-host.ts";

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
