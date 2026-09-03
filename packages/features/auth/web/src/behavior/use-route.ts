/**
 * Where this document is, for a screen that may not import a router.
 *
 * `platform/app` answered both of these from `~/utils/compat/next-*`, which
 * wrap react-router; a feature-web package may import neither, so the address
 * arrives on the host port and these two shims put it back in the shapes the
 * screens were written against. Same names, same return types, so no call site
 * changed on the way over.
 */

import { useMemo } from "react";
import { useAuthHost } from "../model/auth-host";

/** The query string, as `next/navigation` handed it over. */
export function useSearchParams(): URLSearchParams {
  const { query } = useAuthHost().route();
  return useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }, [query]);
}

/** The path this document is at. */
export function usePathname(): string {
  return useAuthHost().route().pathname;
}

/**
 * As much of `next/router` as the front door reads: the matched route and the
 * merged parameters. Nothing here navigates — every departure the front door
 * makes is a full-page one, and those live in `browser-navigation.ts`.
 */
export function useRouter(): {
  route: string;
  pathname: string;
  query: Readonly<Record<string, string | undefined>>;
} {
  const reading = useAuthHost().route();
  return useMemo(
    () => ({
      route: reading.pathname,
      pathname: reading.pathname,
      query: { ...reading.query, ...reading.params },
    }),
    [reading],
  );
}
