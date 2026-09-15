/**
 * Router compat shims for screens unable to import react-router; address from host port
 */

import { useMemo } from "react";
import { useAuthHost } from "../model/auth-host.ts";

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
