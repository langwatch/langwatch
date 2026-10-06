import { useEffect, useMemo, useState } from "react";
import { api, type RouterInputs } from "~/utils/api";

type TraceListInput = Omit<RouterInputs["traces"]["getAllForProject"], "scrollId">;

type TraceListQueryOptions = {
  enabled?: boolean;
  refetchOnMount?: boolean;
  refetchOnWindowFocus?: boolean;
  trpc?: { context?: Record<string, unknown> };
};

type CursorState = { key: string; ids: (string | null)[] };

/**
 * Collects every trace id matching `input` by walking `getAllForProject` one
 * scrollId at a time, up to `maxPages` pages (#8479: each request is capped, so
 * a large result set needs several).
 *
 * Ids are only returned once the walk is finished and no page failed, so
 * downstream queries run once rather than once per page, and a failed page
 * never passes off a partial list as complete.
 */
export function useTraceIdsAcrossPages({
  input,
  queryOpts,
  maxPages,
}: {
  input: TraceListInput;
  queryOpts: TraceListQueryOptions;
  maxPages: number;
}): { traceIds: string[]; isLoading: boolean; isError: boolean } {
  // Cursors are keyed by the filter that produced them, so a filter change
  // never sends the old filter's cursors with the new one.
  const key = JSON.stringify(input);
  const [state, setState] = useState<CursorState>({ key, ids: [null] });
  const scrollIds = state.key === key ? state.ids : [null];

  const pages = api.useQueries((t) =>
    scrollIds.map((scrollId) =>
      t.traces.getAllForProject({ ...input, scrollId }, queryOpts),
    ),
  );

  // The server only sends a scrollId when the page was full.
  const nextScrollId = pages[pages.length - 1]?.data?.scrollId;
  const hasNextPage =
    !!nextScrollId &&
    !scrollIds.includes(nextScrollId) &&
    scrollIds.length < maxPages;

  useEffect(() => {
    if (hasNextPage && nextScrollId) {
      setState({ key, ids: [...scrollIds, nextScrollId] });
    }
  }, [hasNextPage, nextScrollId, key, scrollIds]);

  const isError = pages.some((page) => page.isError);
  const isLoading = pages.some((page) => page.isLoading) || hasNextPage;
  const walkComplete = !isLoading && !isError;

  const traceIds = useMemo(
    () =>
      walkComplete
        ? pages.flatMap(
            (page) =>
              page.data?.groups.flatMap((group) =>
                group.map((trace) => trace.trace_id),
              ) ?? [],
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [walkComplete, ...pages.map((page) => page.data)],
  );

  return { traceIds, isLoading, isError };
}
