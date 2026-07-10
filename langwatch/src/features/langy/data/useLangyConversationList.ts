import { useEffect, useRef } from "react";
import {
  type LangyConversationListQueryResult,
  useLangyConversationListQuery,
} from "./useLangyConversationListQuery";

export interface LangyConversationListResult
  extends LangyConversationListQueryResult {
  /** Ids that appeared since the previous render — used to pulse new arrivals. */
  newIds: Set<string>;
}

/**
 * SIDE-EFFECT wrapper over the pure list query, mirroring the
 * `useTraceListQuery` / `useTraceList` split. Diffs successive result sets to
 * surface newly-arrived conversation ids (for a subtle "new" pulse in the
 * recents list) without pushing that concern into the pure query.
 *
 * Composes the pure hook by the same cache key, so mounting both is free.
 */
export function useLangyConversationList(): LangyConversationListResult {
  const query = useLangyConversationListQuery();
  const prevIdsRef = useRef<Set<string>>(new Set());
  const newIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!query.isFetched) return;
    const current = new Set(query.items.map((item) => item.id));
    const appeared = new Set<string>();
    for (const id of current) {
      if (!prevIdsRef.current.has(id)) appeared.add(id);
    }
    // Don't flag the entire first load as "new" — only diffs after we have a
    // baseline. `prevIdsRef.size === 0` is the cold-start case.
    newIdsRef.current =
      prevIdsRef.current.size === 0 ? new Set() : appeared;
    prevIdsRef.current = current;
  }, [query.items, query.isFetched]);

  return { ...query, newIds: newIdsRef.current };
}
