import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { parseOccurredAtMs } from "./useTraceOccurredAt";

/** Window in which a trace is treated as "live" — spans may still be
 * arriving so the drawer polls every few seconds. Older traces are
 * considered settled and rely on focus + manual refresh. */
const LIVE_WINDOW_MS = 3 * 60 * 1000;
const LIVE_REFETCH_MS = 10_000;

export function useTraceHeader() {
  const { project } = useOrganizationTeamProject();
  // Read traceId from the URL — it's the canonical source of truth on
  // hard reload. Reading from the zustand store would leave the query
  // disabled on the first render (the store only syncs from the URL via
  // a post-mount effect), causing a "Trace not found" flash before the
  // refetch had a chance to run.
  const params = useDrawerParams();
  const traceId = params.traceId;
  const occurredAtMs = parseOccurredAtMs(params.t);

  // Treat the URL hint as our liveness signal. When the trace started
  // within the last 3 min, set a 10s refetch interval so newly arrived
  // spans show up without a manual refresh. Once the trace is older than
  // the window, the interval falls away and the query goes back to its
  // normal staleTime caching behaviour.
  const isLive =
    occurredAtMs !== undefined && Date.now() - occurredAtMs < LIVE_WINDOW_MS;

  return api.tracesV2.header.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
    },
    {
      enabled: !!project?.id && !!traceId,
      staleTime: 300_000,
      cacheTime: 1_800_000,
      keepPreviousData: true,
      refetchOnWindowFocus: true,
      refetchInterval: isLive ? LIVE_REFETCH_MS : false,
    },
  );
}
