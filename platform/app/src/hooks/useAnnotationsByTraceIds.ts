import { useMemo } from "react";
import { api, type RouterOutputs } from "~/utils/api";

export type AnnotationByTrace =
  RouterOutputs["annotation"]["getByTraceIds"][number];

/**
 * tRPC v10 sends queries as GET, so the trace-id array rides in the URL.
 * A whole page of filtered traces (100+ ids) blows past the batch link's
 * 4000-char ceiling and tRPC throws "Input is too big for a single
 * dispatch". Chunk the ids into URL-safe batches and fan them out with
 * `useQueries`, then flatten — so the caller sees one list regardless of
 * how many traces it asked about, with no upper bound on the count.
 */
const CHUNK_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface UseAnnotationsByTraceIdsResult {
  data: AnnotationByTrace[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Annotations for a set of traces.
 *
 * Reads the comments about the traces themselves by default: a surface that
 * answers per trace across a page of them, the annotations list say, must not
 * change what it says because a reviewer marked six spans of one trace. A
 * surface that carries everything said about a trace, its own comments or a
 * dataset's annotations column, passes `anchor: "all"` and gets the anchored
 * ones too.
 */
export function useAnnotationsByTraceIds({
  projectId,
  traceIds,
  enabled = true,
  keepPreviousData = false,
  anchor = "trace",
}: {
  projectId: string;
  traceIds: string[];
  enabled?: boolean;
  keepPreviousData?: boolean;
  anchor?: "trace" | "all";
}): UseAnnotationsByTraceIdsResult {
  // Dedupe before chunking: duplicate ids spanning chunks would fetch the
  // same annotations twice and double them in `data` after the flatMap.
  //
  // Sort too. The chunk contents are the query key, so two consumers reading
  // the same traces in different orders would otherwise key differently and
  // each fetch its own copy of the same annotations.
  const uniqueTraceIds = useMemo(
    () => Array.from(new Set(traceIds)).sort(),
    [traceIds],
  );

  // Stable chunk identity so `useQueries` doesn't refetch every render.
  const chunks = useMemo(
    () => chunk(uniqueTraceIds, CHUNK_SIZE),
    [uniqueTraceIds],
  );

  const results = api.useQueries((t) =>
    chunks.map((ids) =>
      t.annotation.getByTraceIds(
        { projectId, traceIds: ids, anchor },
        {
          enabled: enabled && !!projectId && ids.length > 0,
          keepPreviousData,
          staleTime: 5 * 60_000,
          refetchOnWindowFocus: false,
        },
      ),
    ),
  );

  // `api.useQueries` hands back a NEW array on every render — react-query v4's
  // QueriesObserver.getOptimisticResult maps over its observers each call — so
  // memoising on `results` identity never hits, and `data` would be a fresh
  // array every render. That is not merely wasteful: callers memoise on `data`,
  // and an unstable value there propagates through their memo chains into
  // effects that setState, which is how a render loop starts.
  //
  // Key on a content signature instead. `dataUpdatedAt` changes exactly when a
  // chunk's data changes, and `status` covers the loading/error transitions, so
  // this recomputes when the contents actually move and not otherwise. The
  // chunk's own ids go in too: swap `traceIds` for a different, already-cached
  // set of the same size and every chunk can settle on the same millisecond,
  // leaving the timestamps identical and the memo serving the previous run's
  // annotations.
  const dataSignature = results
    .map(
      (r, i) => `${chunks[i]?.join(",") ?? ""}:${r.dataUpdatedAt}:${r.status}`,
    )
    .join("|");

  const data = useMemo(
    () => results.flatMap((r) => r.data ?? []),
    // `results` is deliberately not a dependency — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataSignature],
  );

  return {
    data,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  };
}
