/**
 * `useRouter`, adapted, for the one screen that still calls it.
 *
 * The queue walker reads `router.query["queue-item"]` and pushes the next
 * item's address. `react-router` is sealed off from a feature package's
 * screens, and the host already answers both: `route().query` is the query
 * string it reads, and `navigate` is the push it makes. Everything else the
 * platform's compat shim published — `pathname`, `asPath`, `isReady`, `events`,
 * `replace`'s second address — is absent because nothing here reads it.
 */

import { useMemo } from "react";

import { useAnnotationHost } from "../model/annotation-host";

export type AnnotationRouter = {
  query: Readonly<Record<string, string | undefined>>;
  push: (to: string) => Promise<void>;
};

export function useRouter(): AnnotationRouter {
  const host = useAnnotationHost();
  const { query } = host.route();
  return useMemo(
    () => ({
      query,
      push: async (to: string) => {
        host.navigate(to);
      },
    }),
    [host, query],
  );
}
