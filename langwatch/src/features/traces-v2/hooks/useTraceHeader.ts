import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isPreviewTraceId } from "../onboarding/data/samplePreviewTraces";
import { LIVE_REFETCH_MS, LIVE_WINDOW_MS } from "../constants/freshness";
import { useDrawerStore } from "../stores/drawerStore";

/** When prompt aggregation is still catching up (containsPrompt=true but
 * the projected IDs haven't landed yet), poll on a slower cadence so the
 * chips fill in without making the user click around. */
const PROMPTS_PENDING_REFETCH_MS = 8_000;

export function useTraceHeader() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);

  // Treat the URL hint as our liveness signal. When the trace started
  // within the last 3 min, set a 10s refetch interval so newly arrived
  // spans show up without a manual refresh. Once the trace is older than
  // the window, the interval falls away and the query goes back to its
  // normal staleTime caching behaviour.
  const isLive =
    occurredAtMs !== null && Date.now() - occurredAtMs < LIVE_WINDOW_MS;

  return api.tracesV2.header.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== null ? { occurredAtMs } : {}),
    },
    {
      enabled:
        !!project?.id && !!traceId && !isPreviewTraceId(traceId),
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
    },
  );
}
