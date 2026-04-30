import { api } from "~/utils/api";
import { LIVE_REFETCH_MS } from "../constants/freshness";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/** When prompt aggregation is still catching up (containsPrompt=true but
 * the projected IDs haven't landed yet), poll on a slower cadence so the
 * chips fill in without making the user click around. */
const PROMPTS_PENDING_REFETCH_MS = 8_000;

export function useTraceHeader() {
  const { isLive, isReady, queryArgs } = useTraceQueryArgs();

  // Treat the URL hint as our liveness signal. When the trace started
  // within the last 3 min, set a 10s refetch interval so newly arrived
  // spans show up without a manual refresh. Once the trace is older than
  // the window, the interval falls away and the query goes back to its
  // normal staleTime caching behaviour.
  return api.tracesV2.header.useQuery(queryArgs, {
    enabled: isReady,
    staleTime: 300_000,
    cacheTime: 1_800_000,
    keepPreviousData: true,
    refetchOnWindowFocus: true,
    refetchInterval: (data) => {
      if (isLive) return LIVE_REFETCH_MS;
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
}
