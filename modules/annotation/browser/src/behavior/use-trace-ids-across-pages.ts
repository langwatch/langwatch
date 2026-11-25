/**
 * Every trace id a filter matches, walking the capped trace list one scrollId
 * at a time up to `maxPages`. Ids arrive only once the walk ends with no failed
 * page, so a failure never passes off a partial list as complete.
 */

import type { traceListInputSchema } from "@langwatch/trace-contract";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";

import { annotationApi } from "./annotation-api.ts";

/** One trace list request, less the cursor this hook walks. */
export type TraceWalkInput = Omit<z.input<typeof traceListInputSchema>, "scrollId">;

type CursorState = { key: string; scrollIds: (string | null)[] };

export function useTraceIdsAcrossPages({
  input,
  enabled,
  maxPages,
}: {
  input: TraceWalkInput;
  enabled: boolean;
  maxPages: number;
}): { traceIds: string[]; isLoading: boolean; isError: boolean } {
  // Cursors are keyed by the request that produced them, so a filter change
  // never sends the old filter's cursors with the new one.
  const key = JSON.stringify(input);
  const [state, setState] = useState<CursorState>({ key, scrollIds: [null] });
  const scrollIds = useMemo(() => (state.key === key ? state.scrollIds : [null]), [state, key]);

  const pages = annotationApi.useQueries((t) =>
    scrollIds.map((scrollId) =>
      t.traces.getAllForProject(
        { ...input, scrollId },
        { enabled, refetchOnMount: false, refetchOnWindowFocus: false },
      ),
    ),
  );

  // The server sends a scrollId only when the page was full.
  const nextScrollId = enabled ? pages.at(-1)?.data?.scrollId : void 0;
  const hasNextPage =
    !!nextScrollId && !scrollIds.includes(nextScrollId) && scrollIds.length < maxPages;

  useEffect(() => {
    if (hasNextPage && nextScrollId) {
      setState({ key, scrollIds: [...scrollIds, nextScrollId] });
    }
  }, [hasNextPage, nextScrollId, key, scrollIds]);

  const isError = enabled && pages.some((page) => page.isError);
  const isLoading = enabled && (pages.some((page) => page.isLoading) || hasNextPage);
  const walkComplete = enabled && !isLoading && !isError;

  const allIds = walkComplete
    ? pages.flatMap(
        (page) => page.data?.groups.flatMap((group) => group.map((trace) => trace.trace_id)) ?? [],
      )
    : [];
  // useQueries answers a new array every render and the ids feed a query key,
  // so the same array is kept while the ids are unchanged.
  const idsKey = JSON.stringify(allIds);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids' content
  const traceIds = useMemo(() => allIds, [idsKey]);

  return { traceIds, isLoading, isError };
}
