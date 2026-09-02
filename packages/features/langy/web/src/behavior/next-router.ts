/**
 * `useRouter`, as this package still spells it.
 *
 * `~/utils/compat/next-router` is the application's shim over react-router, and
 * ADR-004 seals react-router off from a feature package. Eleven call sites read
 * `query`, `pathname` and `asPath` and push one address; all of that is on the
 * host port already, so this is an adapter and not a router.
 */

import { useMemo } from "react";

import { useLangyHost } from "../model/langy-host";

export type LangyCompatRouter = {
  query: Readonly<Record<string, string | string[] | undefined>>;
  pathname: string;
  route: string;
  asPath: string;
  isReady: boolean;
  push: (url: string, as?: unknown, options?: { replace?: boolean }) => void;
  replace: (url: string, as?: unknown, options?: { replace?: boolean }) => void;
};

export function useRouter(): LangyCompatRouter {
  const host = useLangyHost();
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
      push: (url: string) => host.navigate(url),
      replace: (url: string) => host.navigate(url, { replace: true }),
    };
  }, [host, reading]);
}

export default { push: (url: string) => void url };
