import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { LIVE_WINDOW_MS } from "../constants/freshness";
import { isPreviewTraceId } from "../onboarding/data/samplePreviewTraces";
import { useDrawerStore } from "../stores/drawerStore";

/**
 * Shared base wiring for the per-trace tRPC queries fired off the open
 * drawer (header, span tree, signals, detail prefetch, etc.). Each
 * caller composes their own React Query options on top — this hook just
 * derives the inputs that they all recompute identically:
 *
 *   - `project` (resolved org/team/project),
 *   - `traceId` from the drawer store,
 *   - `occurredAtMs` URL hint for ClickHouse partition pruning,
 *   - `isLive` rolling-window flag for live refetch cadence,
 *   - `queryArgs` ready to spread into a `useQuery({ ... })` input.
 *
 * Callers should still gate `enabled` on their own preconditions and
 * decide their own staleTime / refetchInterval.
 */
export function useTraceQueryArgs() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);

  const isLive =
    occurredAtMs !== null && Date.now() - occurredAtMs < LIVE_WINDOW_MS;

  const queryArgs = {
    projectId: project?.id ?? "",
    traceId: traceId ?? "",
    ...(occurredAtMs !== null ? { occurredAtMs } : {}),
  };

  const isReady = !!project?.id && !!traceId && !isPreviewTraceId(traceId ?? "");

  return { project, traceId, occurredAtMs, isLive, isReady, queryArgs };
}
