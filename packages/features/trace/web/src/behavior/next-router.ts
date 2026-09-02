/**
 * `useRouter`, as this package still spells it.
 *
 * `~/utils/compat/next-router` is the application's shim over react-router, and
 * ADR-004 seals react-router off from a feature package. Five call sites read
 * `query`, `pathname` and `route`, and three call `push`; all of those are on
 * the host port already, so this is an adapter and not a router.
 *
 * `push` takes the Next signature (`url, as, options`) because that is what the
 * call sites pass; only the first argument is used, which is all any of them
 * ever varied.
 */

import { useMemo } from "react";

import { useTraceHost } from "./trace-host";

export type TraceCompatRouter = {
  query: Readonly<Record<string, string | undefined>>;
  pathname: string;
  route: string;
  asPath: string;
  isReady: boolean;
  push: (url: string, as?: unknown, options?: { replace?: boolean }) => void;
  replace: (url: string, as?: unknown, options?: { replace?: boolean }) => void;
};

export function useRouter(): TraceCompatRouter {
  const host = useTraceHost();
  const reading = host.route();
  return useMemo(() => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(reading.query)) {
      if (value !== void 0) search.set(key, value);
    }
    const queryString = search.toString();
    return {
      query: { ...reading.params, ...reading.query },
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
