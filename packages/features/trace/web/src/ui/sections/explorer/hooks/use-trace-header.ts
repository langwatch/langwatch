import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { applyOverlayToTraceHeader } from "../../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views";
import { api } from "../../trace-api";
import { LIVE_REFETCH_MS, useDrawerStore, useSseStatusStore } from "../../../../index";
import { asSharedQueryResult, useSharedTrace } from "../context/shared-trace-context";
import { useAppliedTraceEditPatch } from "./use-trace-edit-overlay";
import { useTraceQueryArgs } from "./use-trace-query-args";

/** When prompt aggregation is still catching up (containsPrompt=true but
 * the projected IDs haven't landed yet), poll on a slower cadence so the
 * chips fill in without making the user click around. */
const PROMPTS_PENDING_REFETCH_MS = 8_000;

/**
 * The trace header exactly as captured, before any correction. Read it when
 * the captured trace is the point: the Original view and the difference view.
 */
export function useTraceHeaderCanonical() {
  const shared = useSharedTrace();
  const { isLive, isReady, queryArgs } = useTraceQueryArgs();
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);
  const backfillOccurredAtMs = useDrawerStore((s) => s.backfillOccurredAtMs);
  // SSE-aware polling: when `useTraceFreshness` has an active subscription,
  // `trace_summary_updated` events invalidate this query push-style and any timer is
  // redundant.
  const sseConnected = useSseStatusStore((s) => s.sseConnectionState === "connected");

  // Treat the URL hint as our liveness signal. When the trace started within the last 3
  // min and SSE is OFF, set a 10s refetch interval so newly arrived spans show up
  // without a manual refresh.
  const query = api.tracesV2.header.useQuery(
    { ...queryArgs, full: true },
    {
      enabled: isReady && !shared,
      staleTime: 300_000,
      gcTime: 1_800_000,
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: true,
      refetchInterval: (query) => {
        if (isLive && !sseConnected) return LIVE_REFETCH_MS;
        // The trace knows it used a prompt but the rollup hasn't
        // populated the IDs yet — keep polling on a slower cadence so
        // the chips fill in without the user clicking around. Once an
        // ID is present we go quiet again.
        const data = query.state.data;
        if (data?.containsPrompt && !data.lastUsedPromptId) {
          return PROMPTS_PENDING_REFETCH_MS;
        }
        return false;
      },
    },
  );

  // When the drawer opened without a partition hint (deep link / refresh whose URL
  // carried no `t`), the header itself runs an unconstrained by-id scan — but its
  // result carries the trace's real timestamp.
  const resolvedTimestamp =
    query.data?.traceId === queryArgs.traceId ? query.data.timestamp : undefined;
  useEffect(() => {
    if (occurredAtMs === null && typeof resolvedTimestamp === "number") {
      backfillOccurredAtMs(resolvedTimestamp);
    }
  }, [occurredAtMs, resolvedTimestamp, backfillOccurredAtMs]);

  if (shared) return asSharedQueryResult(shared.header) as unknown as typeof query;
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
