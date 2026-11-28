import type { SpanTreeNode } from "@langwatch/trace-contract";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAppliedTraceEditPatch } from "../../../behavior/explorer/use-trace-edit-overlay.ts";
import { useTraceQueryArgs } from "../../../behavior/explorer/use-trace-query-args.ts";
import { api } from "../../../behavior/trace-api.ts";
import { useTraceDrawer } from "../../../behavior/trace-drawer.ts";
import { selectedSpanOwnerIn } from "../../../model/braids/braided-span.ts";
import { applyOverlayToSpanDetail } from "../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views.ts";
import { spanTreeQueryKey } from "./span-tree-paged-query.ts";

/**
 * The braid owner of a span id in the tree the drawer already loaded, read from the cache
 * without fetching; undefined for the reader's own span (ADR-201 §5).
 */
function useSelectedSpanOwner(spanId: string | null): string | undefined {
  const { queryArgs } = useTraceQueryArgs();
  const { data } = useQuery({
    queryKey: spanTreeQueryKey(queryArgs),
    queryFn: skipToken,
    select: (nodes: SpanTreeNode[]) => selectedSpanOwnerIn({ nodes, spanId }),
  });
  return data;
}

/**
 * The selected span exactly as captured, before any correction. Read it when
 * the captured value is the point: the hover-original marks and the difference
 * view.
 */
export function useSpanDetailCanonical() {
  const { isReady, queryArgs } = useTraceQueryArgs();
  const spanId = useTraceDrawer((s) => s.selectedSpanId);
  const ownerProjectId = useSelectedSpanOwner(spanId);

  return api.traces.spanDetail.useQuery(
    { ...queryArgs, spanId: spanId ?? "", ...(ownerProjectId ? { ownerProjectId } : {}) },
    {
      enabled: isReady && !!spanId,
    },
  );
}

/**
 * The selected span as the reader sees it: corrected when a correction applies,
 * captured otherwise.
 */
export function useSpanDetail() {
  const query = useSpanDetailCanonical();
  const patch = useAppliedTraceEditPatch();
  const detail = query.data;

  const data = useMemo(
    () => (detail ? applyOverlayToSpanDetail({ detail, patch }) : detail),
    [detail, patch],
  );

  return useMemo(() => (data === detail ? query : { ...query, data }), [query, data, detail]);
}
