import type { QueryClient } from "@tanstack/react-query";
import { getUntypedClient } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import type {
  SpanTreeCursor,
  SpanTreeNode,
} from "@langwatch/contracts/traces-v2";
import { api, type RouterOutputs } from "~/utils/api";

/*
 * Traces can carry 20k–100k+ spans, so the span tree is never fetched as a
 * single response. The tRPC `spanTree` procedure remains the cache-key anchor
 * — preview-mode seeding, SSE invalidation, refresh, and close-time cancel all
 * go through `utils.tracesV2.spanTree` — but nothing fetches through it any
 * more: the query function built here pages through `spanTreePaginated` and
 * assembles the tree client-side, publishing pages progressively so the
 * waterfall starts painting after the first page.
 */

/**
 * Rows per `spanTreePaginated` page: large enough that the common trace
 * (p999 ≈ 312 spans) still loads in one round trip, small enough that a
 * 100k-span trace streams into the waterfall instead of stalling on one
 * giant response.
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

/**
 * Ascending `(startTimeMs, spanId)` — the order pages arrive in and the order
 * the assembled tree is kept in. SpanId ties break bytewise to match the
 * ClickHouse `SpanId ASC` collation.
 */
function bySpanTreeOrder(a: SpanTreeNode, b: SpanTreeNode): number {
  if (a.startTimeMs !== b.startTimeMs) return a.startTimeMs - b.startTimeMs;
  return a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0;
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
    return needsSort ? nodes.sort(bySpanTreeOrder) : nodes;
  };
  // Vanilla-client queries, not `utils.….fetch`: the abort signal reaches
  // the in-flight HTTP request (closing the drawer cancels mid-page, not
  // just between pages), and no throwaway per-page React Query cache
  // entries are created — the assembled tree lives under the spanTree key.
  //
  // `utils.client` is not the vanilla client — `useUtils()` hands back
  // `createTRPCClientProxy(client)`, and that proxy only resolves a key to the
  // real client when the client *owns* it. `query` lives on
  // `TRPCUntypedClient.prototype`, so `utils.client.query` is a recursive path
  // proxy instead; binding it yields a function that throws on call
  // (`clientCallTypeToProcedureType("bind")` is `undefined`). `getUntypedClient`
  // unwraps the proxy back to the client the provider was built with.
  //
  // Dot-path form with a pinned signature: the typed proxy cannot wrap this
  // router (its `subscription` procedure collides with the proxy's reserved
  // method names), and `query`'s own generic is keyed to the empty v10 legacy
  // `_def.queries` interop shape, so neither types this call natively.
  const client = getUntypedClient(
    utils.client as unknown as Parameters<typeof getUntypedClient>[0],
  );
  const queryPage = client.query.bind(client) as (
    path: "tracesV2.spanTreePaginated",
    input: SpanTreeQueryInput & { limit: number; cursor?: SpanTreeCursor },
    opts?: { signal?: AbortSignal },
  ) => Promise<RouterOutputs["tracesV2"]["spanTreePaginated"]>;
  let cursor: SpanTreeCursor | undefined;
  for (;;) {
    if (signal?.aborted) {
      throw new DOMException("span tree fetch aborted", "AbortError");
    }
    const page = await queryPage(
      "tracesV2.spanTreePaginated",
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

/**
 * Lower bound for the live-delta poll over a loaded tree: 1ms before the
 * newest ROW VERSION it holds.
 *
 * Keyed on `updatedAtMs`, not `startTimeMs`. A span updated in place — end
 * time, duration, status, cost, all re-projected as it closes — keeps its
 * start time, so a start-keyed mark can only ever surface brand-new spans.
 * The root span is the worst case: it starts first and ends last, so its
 * duration (and with it the waterfall's whole time scale) stayed frozen at
 * first projection for as long as SSE was down.
 *
 * Both bounds are ms-truncated from `DateTime64(3)`, so a row written later
 * within the same millisecond as the mark would be missed by a strict `>`;
 * backing off 1ms re-fetches the boundary rows and
 * {@link mergeSpanTreeDelta} dedupes them.
 *
 * 0 for an empty tree, so a live trace whose spans haven't been ingested yet
 * still picks them up — and likewise for preview fixtures carrying no
 * version, where the mark corrects itself on the first server-sourced row.
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

/**
 * Merges a `spanTreeDelta` result into the assembled tree: dedupes by spanId
 * (a delta row is the span's latest version, so it wins), keeps the tree in
 * `(startTimeMs, spanId)` order, and returns the SAME array reference when
 * nothing actually changed — the delta poll re-fetches boundary rows every
 * cycle, and an unchanged reference keeps React Query consumers from
 * re-rendering on quiet polls.
 */
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
  return [...byId.values()].sort(bySpanTreeOrder);
}
