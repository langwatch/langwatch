import { useMemo } from "react";

import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { applyOverlayToSpanDetail } from "../../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views.ts";
import { useAppliedTraceEditPatch } from "./use-trace-edit-overlay.ts";
import { useTraceQueryArgs } from "./use-trace-query-args.ts";

/**
 * The selected span exactly as captured, before any correction. Read it when
 * the captured value is the point: the hover-original marks and the difference
 * view.
 */
export function useSpanDetailCanonical() {
  const { isReady, hintReady, queryArgs } = useTraceQueryArgs();
  const spanId = useTraceDrawer((s) => s.selectedSpanId);

  return api.traces.spanDetail.useQuery(
    { ...queryArgs, spanId: spanId ?? "" },
    {
      enabled: isReady && hintReady && !!spanId,
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
