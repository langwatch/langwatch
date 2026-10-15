/**
 * How fresh a read is: when it was answered, and whether the network has confirmed a copy
 * drawn from disk since. specs/ui/browser-query-caching.feature.
 */

import { Temporal, type Instant } from "@langwatch/time";
import { hashKey, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { isRestoredFromDisk } from "./query-persistence.ts";

/** `asOf` is when the data was fetched, a restored copy's original fetch included. */
export type UiReadFreshness = Readonly<{ asOf: Instant | null; confirmed: boolean }>;

export function useReadFreshness({ queryKey }: { queryKey: QueryKey }): UiReadFreshness {
  const queryClient = useQueryClient();
  const queryHash = hashKey(queryKey);
  const subscribe = useCallback(
    (onChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === queryHash) onChange();
      }),
    [queryClient, queryHash],
  );
  const held = () => queryClient.getQueryCache().get(queryHash);
  const updatedAt = useSyncExternalStore(subscribe, () => held()?.state.dataUpdatedAt ?? 0);
  const confirmed = useSyncExternalStore(subscribe, () => {
    const query = held();
    return !query || !isRestoredFromDisk({ queryClient, query });
  });
  const asOf = useMemo(
    () => (updatedAt === 0 ? null : Temporal.Instant.fromEpochMilliseconds(updatedAt)),
    [updatedAt],
  );

  return { asOf, confirmed };
}
