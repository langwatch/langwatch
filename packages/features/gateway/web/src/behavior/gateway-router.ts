/**
 * The address, as the gateway screens read and write it.
 *
 * They arrived using `~/utils/compat/next-router`'s `useRouter` (path
 * parameters and the query string merged into one `query` bag), which is a
 * router import a feature-web package may not make, so it is re-bound to the
 * host's route capability with the shape the call sites already expect.
 *
 * `push` and `replace` take the same strings the pages pass today: an absolute
 * path navigates, and a bare `"?a=b"` rewrites the query of the current page.
 */

import { useMemo } from "react";
import { useGatewayHost } from "../model/gateway-host";

export type GatewayRouter = {
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

export function useGatewayRouter(): GatewayRouter {
  const host = useGatewayHost();
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
