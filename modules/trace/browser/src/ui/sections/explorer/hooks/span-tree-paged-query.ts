import type { SpanTreeCursor, SpanTreeNode } from "@langwatch/trace-contract";
import type { QueryClient } from "@tanstack/react-query";
import { getUntypedClient } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";

import { api, type RouterOutputs } from "../../../../behavior/trace-api.ts";

/*
 * Traces can carry 20k–100k+ spans, so the span tree is never fetched as a single
 * response.
 */

/**
 * Rows per `spanTreePaginated` page: large enough that the common trace (p999 ≈ 312
 * spans) still loads in one round trip, small enough that a 100k-span trace streams
 * into the waterfall instead of stalling on one giant response.
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
 * `utils.traces.spanTree` keep operating on the same cache entry.
 */
export function spanTreeQueryKey(input: SpanTreeQueryInput) {
  return getQueryKey(api.traces.spanTree, input, "query");
}

/**
 * Ascending `(startTimeMs, spanId)` — the order pages arrive in and the order
 * the assembled tree is kept in. SpanId ties break bytewise to match the
 * ClickHouse `SpanId ASC` collation.
 */
function bySpanTreeOrder(a: SpanTreeNode, b: SpanTreeNode): number {
  if (a.startTimeMs !== b.startTimeMs) return a.startTimeMs - b.startTimeMs;
  if (a.spanId < b.spanId) return -1;
  return a.spanId > b.spanId ? 1 : 0;
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
  // Accumulate by spanId, last write wins: pages are keyed by
  // (startTimeMs, spanId), so a span re-emitted with a corrected start time
  // mid-walk could land on two pages — deduping here keeps it a single
  // waterfall row (and a single React key).
  const nodesById = new Map<string, SpanTreeNode>();
  // Pages arrive in (startTimeMs, spanId) order, and `Map.set` keeps an
  // updated key at its original position — so the assembled tree only falls
  // out of order when a later page re-emits a span (corrected start time).
  // Track that case instead of unconditionally re-sorting per page.
  let needsSort = false;
  const materialize = () => {
    const nodes = [...nodesById.values()];
    return needsSort ? nodes.toSorted(bySpanTreeOrder) : nodes;
  };
  // Vanilla queries for abort signal (drawer close cancels mid-page);
  // tree cached under spanTree key, not per-page React Query entries.
  const client = getUntypedClient(
    utils.client as unknown as Parameters<typeof getUntypedClient>[0],
  );
  const queryPage = client.query.bind(client) as (
    path: "traces.spanTreePaginated",
    input: SpanTreeQueryInput & { limit: number; cursor?: SpanTreeCursor },
    opts?: { signal?: AbortSignal },
  ) => Promise<RouterOutputs["traces"]["spanTreePaginated"]>;
  let cursor: SpanTreeCursor | undefined;
  for (;;) {
    if (signal?.aborted) {
      throw new DOMException("span tree fetch aborted", "AbortError");
    }
    const page = await queryPage(
      "traces.spanTreePaginated",
      { ...input, limit: SPAN_TREE_PAGE_SIZE, cursor },
      { signal },
    );
    if (signal?.aborted) {
      throw new DOMException("span tree fetch aborted", "AbortError");
    }
    for (const node of page.nodes) {
      if (nodesById.has(node.spanId)) needsSort = true;
      nodesById.set(node.spanId, node);
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    onPage?.(materialize());
  }
  return materialize();
}

/**
 * Query function for the span-tree cache entry.
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

/**
 * Lower bound for the live-delta poll over a loaded tree: 1ms before the newest ROW
 * VERSION it holds.
 */
export function spanTreeDeltaSinceMs(nodes: SpanTreeNode[]): number {
  let highWaterMs = 0;
  for (const node of nodes) {
    const updatedAtMs = node.updatedAtMs ?? 0;
    if (updatedAtMs > highWaterMs) highWaterMs = updatedAtMs;
  }
  return highWaterMs === 0 ? 0 : Math.max(0, highWaterMs - 1);
}

/** Every field of SpanTreeNode is a scalar (or null), so shallow works. */
function sameNode(a: SpanTreeNode, b: SpanTreeNode): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a) as (keyof SpanTreeNode)[];
  const keysB = Object.keys(b) as (keyof SpanTreeNode)[];
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

// Merge spanTreeDelta: dedupe by spanId, maintain order, return same
// reference when unchanged (avoid React Query re-renders on quiet polls).
export function mergeSpanTreeDelta(
  existing: SpanTreeNode[],
  delta: SpanTreeNode[],
): SpanTreeNode[] {
  if (delta.length === 0) return existing;
  const byId = new Map(existing.map((node) => [node.spanId, node]));
  let changed = false;
  for (const node of delta) {
    const prev = byId.get(node.spanId);
    if (prev !== undefined && sameNode(prev, node)) continue;
    byId.set(node.spanId, node);
    changed = true;
  }
  if (!changed) return existing;
  return [...byId.values()].toSorted(bySpanTreeOrder);
}
