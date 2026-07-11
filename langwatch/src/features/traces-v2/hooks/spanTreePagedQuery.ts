import type { QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type {
  SpanTreeCursor,
  SpanTreeNode,
} from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";

/**
 * Traces can carry 20k–100k+ spans, so the span tree is never fetched as a
 * single response. The tRPC `spanTree` procedure remains the cache-key anchor
 * — preview-mode seeding, SSE invalidation, refresh, and close-time cancel all
 * go through `utils.tracesV2.spanTree` — but nothing fetches through it any
 * more: the query function built here pages through `spanTreePaginated` and
 * assembles the tree client-side, publishing pages progressively so the
 * waterfall starts painting after the first page.
 */
export const SPAN_TREE_PAGE_SIZE = 500;

export interface SpanTreeQueryInput {
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
}

type TrpcUtils = ReturnType<typeof api.useUtils>;

/**
 * React Query key of the assembled span tree — identical to the key the tRPC
 * `spanTree.useQuery` hook would produce, so setData / invalidate / cancel via
 * `utils.tracesV2.spanTree` keep operating on the same cache entry.
 */
export function spanTreeQueryKey(input: SpanTreeQueryInput) {
  return getQueryKey(api.tracesV2.spanTree, input, "query");
}

export async function fetchSpanTreePages({
  utils,
  input,
  signal,
  onPage,
}: {
  utils: TrpcUtils;
  input: SpanTreeQueryInput;
  signal?: AbortSignal;
  onPage?: (nodes: SpanTreeNode[]) => void;
}): Promise<SpanTreeNode[]> {
  const nodes: SpanTreeNode[] = [];
  let cursor: SpanTreeCursor | undefined;
  for (;;) {
    if (signal?.aborted) {
      throw new DOMException("span tree fetch aborted", "AbortError");
    }
    const page = await utils.tracesV2.spanTreePaginated.fetch(
      { ...input, limit: SPAN_TREE_PAGE_SIZE, cursor },
      // Pages are throwaway transport: the assembled tree lives under the
      // spanTree key, so don't keep per-page cache entries around (for a
      // 100k-span trace they would double the client-side footprint).
      { cacheTime: 0 },
    );
    if (signal?.aborted) {
      throw new DOMException("span tree fetch aborted", "AbortError");
    }
    nodes.push(...page.nodes);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    onPage?.([...nodes]);
  }
  return nodes;
}

/**
 * Query function for the span-tree cache entry. Progressive publishing only
 * kicks in while the entry is smaller than what has been fetched — during a
 * refetch (SSE invalidation, refresh) the cache still holds the full previous
 * tree, and publishing a smaller partial would collapse the waterfall and
 * re-grow it page by page.
 */
export function spanTreeQueryFn({
  utils,
  queryClient,
  input,
}: {
  utils: TrpcUtils;
  queryClient: QueryClient;
  input: SpanTreeQueryInput;
}) {
  const queryKey = spanTreeQueryKey(input);
  return ({ signal }: { signal?: AbortSignal }) =>
    fetchSpanTreePages({
      utils,
      input,
      signal,
      onPage: (partial) => {
        const existing = queryClient.getQueryData<SpanTreeNode[]>(queryKey);
        if (existing && existing.length >= partial.length) return;
        queryClient.setQueryData(queryKey, partial);
      },
    });
}
