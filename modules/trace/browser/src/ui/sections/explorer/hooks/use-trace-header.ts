import type { SpanTreeNode } from "@langwatch/trace-contract";
import { useEffect, useMemo } from "react";

import { api } from "../../../../behavior/trace-api.ts";
import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { applyOverlayToTraceHeader } from "../../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views.ts";
import { deriveOccurredAtBackfill } from "../../../../model/traces/trace-occurred-at-backfill.ts";
import { useAppliedTraceEditPatch } from "./use-trace-edit-overlay.ts";
import { useTraceListRowHeader } from "./use-trace-list-row-header.ts";
import { useTraceQueryArgs } from "./use-trace-query-args.ts";

/**
 * The trace header exactly as captured, before any correction. Read it when
 * the captured trace is the point: the Original view and the difference view.
 */
export function useTraceHeaderCanonical() {
  const { isReady, queryArgs } = useTraceQueryArgs();
  const rowHeader = useTraceListRowHeader();
  const occurredAtMs = useTraceDrawer((s) => s.occurredAtMs);
  const backfillOccurredAtMs = useTraceDrawer((s) => s.backfillOccurredAtMs);
  const query = api.traces.header.useQuery(
    { ...queryArgs, full: true },
    {
      enabled: isReady,
      gcTime: 1_800_000,
      placeholderData: () => rowHeader(queryArgs.traceId),
      // needs a read hint: trace prompt rollup projected (containsPrompt without a prompt id)
    },
  );

  // When the drawer opened without a partition hint (deep link / refresh whose URL
  // carried no `t`), the header itself runs an unconstrained by-id scan — but its
  // result carries the trace's real timestamp.
  const resolvedTimestamp = deriveOccurredAtBackfill({
    occurredAtMs,
    header: query.data,
    traceId: queryArgs.traceId,
    isPlaceholderData: query.isPlaceholderData,
  });
  useEffect(() => {
    if (resolvedTimestamp !== undefined) backfillOccurredAtMs(resolvedTimestamp);
  }, [resolvedTimestamp, backfillOccurredAtMs]);

  return query;
}

/**
 * The trace header as the reader sees it: corrected when a correction applies, captured
 * otherwise.
 */
export function useTraceHeader({
  spans,
}: {
  /** The spans as captured, for counting the ones a correction removes. */
  spans?: SpanTreeNode[];
} = {}) {
  const query = useTraceHeaderCanonical();
  const patch = useAppliedTraceEditPatch();
  const header = query.data;

  const data = useMemo(
    () => (header ? applyOverlayToTraceHeader({ header, patch, spans }) : header),
    [header, patch, spans],
  );

  return useMemo(() => (data === header ? query : { ...query, data }), [query, data, header]);
}
