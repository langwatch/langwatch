import { useMemo } from "react";
import { applyOverlayToSpanDetail } from "~/server/traces/edit-overlay/applyTraceEditOverlayToViews";
import { api } from "~/utils/api";
import {
  asSharedQueryResult,
  useSharedTrace,
} from "../context/SharedTraceContext";
import { useDrawerStore } from "../stores/drawerStore";
import { useAppliedTraceEditPatch } from "./useTraceEditOverlay";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/**
 * The selected span exactly as captured, before any correction. Read it when
 * the captured value is the point: the hover-original marks and the difference
 * view.
 */
export function useSpanDetailCanonical() {
  const shared = useSharedTrace();
  const { isReady, queryArgs } = useTraceQueryArgs();
  const spanId = useDrawerStore((s) => s.selectedSpanId);

  const query = api.tracesV2.spanDetail.useQuery(
    { ...queryArgs, spanId: spanId ?? "" },
    {
      enabled: isReady && !!spanId && !shared,
      staleTime: 300_000,
    },
  );

  if (shared) {
    // The shared payload's spansFull entries are the bulk-mapped details:
    // they carry no per-span events and no llm ancestor-prompt enrichment
    // (both live only on the single-span `tracesV2.spanDetail` read). The
    // trace-level events timeline covers the share page; per-span events in
    // the payload are an ADR-057 follow-up.
    const detail = spanId
      ? shared.spansFull.find((s) => s.spanId === spanId)
      : undefined;
    return asSharedQueryResult(detail) as unknown as typeof query;
  }
  return query;
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

  return useMemo(
    () => (data === detail ? query : { ...query, data }),
    [query, data, detail],
  );
}
