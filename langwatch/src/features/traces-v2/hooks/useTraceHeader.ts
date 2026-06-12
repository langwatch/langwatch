import { useEffect } from "react";
import { api } from "~/utils/api";
import { LIVE_REFETCH_MS } from "../constants/freshness";
import { useDrawerStore } from "../stores/drawerStore";
import { useSseStatusStore } from "../stores/sseStatusStore";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/** When prompt aggregation is still catching up (containsPrompt=true but
 * the projected IDs haven't landed yet), poll on a slower cadence so the
 * chips fill in without making the user click around. */
const PROMPTS_PENDING_REFETCH_MS = 8_000;

export function useTraceHeader() {
  const { isLive, isReady, queryArgs } = useTraceQueryArgs();
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);
  const backfillOccurredAtMs = useDrawerStore((s) => s.backfillOccurredAtMs);
  // SSE-aware polling: when `useTraceFreshness` has an active
  // subscription, `trace_summary_updated` events invalidate this query
  // push-style and any timer is redundant. The prompt-pending fallback
  // still runs regardless — it's not an SSE-covered transition (the
  // prompt aggregator writes asynchronously and doesn't broadcast a
  // trace-updated event when only the `lastUsedPromptId` slot fills in).
  const sseConnected = useSseStatusStore(
    (s) => s.sseConnectionState === "connected",
  );

  // Treat the URL hint as our liveness signal. When the trace started
  // within the last 3 min and SSE is OFF, set a 10s refetch interval so
  // newly arrived spans show up without a manual refresh. Once the
  // trace is older than the window, the interval falls away and the
  // query goes back to its normal staleTime caching behaviour.
  const query = api.tracesV2.header.useQuery(queryArgs, {
    enabled: isReady,
    staleTime: 300_000,
    cacheTime: 1_800_000,
    keepPreviousData: true,
    refetchOnWindowFocus: true,
    refetchInterval: (data) => {
      if (isLive && !sseConnected) return LIVE_REFETCH_MS;
      // The trace knows it used a prompt but the rollup hasn't
      // populated the IDs yet — keep polling on a slower cadence so
      // the chips fill in without the user clicking around. Once an
      // ID is present we go quiet again.
      if (data?.containsPrompt && !data.lastUsedPromptId) {
        return PROMPTS_PENDING_REFETCH_MS;
      }
      return false;
    },
  });

  // When the drawer opened without a partition hint (deep link / refresh
  // whose URL carried no `t`), the header itself runs an unconstrained
  // by-id scan — but its result carries the trace's real timestamp. Feed
  // that back into the store so the drawer's *other* per-trace reads
  // (span tree, events, signals) and any header refetch prune partitions
  // instead of cold-scanning `stored_spans` on S3. No-op when a hint was
  // already present, so a correct opener-supplied value is never lost.
  const resolvedTimestamp = query.data?.timestamp;
  useEffect(() => {
    if (occurredAtMs === null && typeof resolvedTimestamp === "number") {
      backfillOccurredAtMs(resolvedTimestamp);
    }
  }, [occurredAtMs, resolvedTimestamp, backfillOccurredAtMs]);

  return query;
}
