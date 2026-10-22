import type { SpanTreeNode } from "@langwatch/trace-contract";
import { skipToken, useQuery } from "@tanstack/react-query";

import { useTraceQueryArgs } from "../../../behavior/explorer/use-trace-query-args.ts";
import { selectedSpanOwnerIn } from "../../../model/braids/braided-span.ts";
import { spanTreeQueryKey } from "./span-tree-paged-query.ts";

/**
 * The braid owner of a span id in the tree the drawer already loaded, read from the cache
 * without fetching; undefined for the reader's own span (ADR-183 §5).
 */
export function useSelectedSpanOwner(spanId: string | null): string | undefined {
  const { queryArgs } = useTraceQueryArgs();
  const { data } = useQuery({
    queryKey: spanTreeQueryKey(queryArgs),
    queryFn: skipToken,
    select: (nodes: SpanTreeNode[]) => selectedSpanOwnerIn({ nodes, spanId }),
  });
  return data;
}
