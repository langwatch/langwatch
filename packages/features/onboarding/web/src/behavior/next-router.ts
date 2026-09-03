/**
 * `useRouter`, as this package still spells it.
 *
 * `~/utils/compat/next-router` is the application's shim over react-router, and
 * ADR-004 seals react-router off from a feature package. Six call sites read
 * `query`, `pathname` and `asPath` and four push; all of that is on the host
 * port already, so this is an adapter and not a router.
 *
 * `push` keeps the Next SIGNATURE — `(url, as, options)` where `url` may be a
 * `{ pathname, query }` object — because `use-generic-onboarding-flow` builds
 * one, and the whole point of a name-preserving shim is that the call site does
 * not change. An object push is resolved here into the address the host takes.
 * It answers a Promise for the same reason: that hook chains `.then()` off it.
 */

import { useMemo } from "react";
import { useOnboardingHost } from "../model/onboarding-host";

type PushTarget = string | { pathname?: string; query?: Readonly<Record<string, unknown>> };

export type OnboardingCompatRouter = {
  query: Readonly<Record<string, string | undefined>>;
  pathname: string;
  route: string;
  asPath: string;
  isReady: boolean;
  push: (url: PushTarget, as?: unknown, options?: { shallow?: boolean }) => Promise<void>;
  replace: (url: PushTarget, as?: unknown, options?: { shallow?: boolean }) => Promise<void>;
};

function addressOf(target: PushTarget, fallbackPathname: string): { href: string } {
  if (typeof target === "string") return { href: target };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(target.query ?? {})) {
    if (value === void 0 || value === null) continue;
    search.set(key, String(value));
  }
  const queryString = search.toString();
  const pathname = target.pathname ?? fallbackPathname;
  return { href: queryString ? `${pathname}?${queryString}` : pathname };
}

export function useRouter(): OnboardingCompatRouter {
  const host = useOnboardingHost();
  const reading = host.route();
  return useMemo(() => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(reading.query)) {
      if (value !== void 0) search.set(key, value);
    }
    const queryString = search.toString();
    return {
      // Path parameters and the query string read as one bag, which is the
      // shape the Next router had and what `router.query.team` depends on.
      query: { ...reading.params, ...reading.query },
      pathname: reading.pathname,
      route: reading.pathname,
      asPath: queryString ? `${reading.pathname}?${queryString}` : reading.pathname,
      isReady: true,
      push: (url: PushTarget) => {
        host.navigate(addressOf(url, reading.pathname).href);
        return Promise.resolve();
      },
      replace: (url: PushTarget) => {
        host.replace(addressOf(url, reading.pathname).href);
        return Promise.resolve();
      },
    };
  }, [host, reading]);
}
