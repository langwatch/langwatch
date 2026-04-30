import { useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";

const EMPTY: never[] = [];

export function useTraceFacets() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);

  const query = api.tracesV2.discover.useQuery(
    {
      projectId: projectId ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
    },
    {
      enabled: !!projectId,
      // Discover returns the *schema* of available facet keys (which
      // attributes exist, with counts) — it shifts on the order of
      // minutes, not seconds. SSE invalidates this on real changes.
      staleTime: 10 * 60_000,
      // Keep prior facets visible across time-range / filter refetches so
      // the sidebar doesn't flicker. Project switches are gated below by
      // remembering which project the cached response belongs to.
      keepPreviousData: true,
      // Discover must not batch with `list`: the list query is the slow one
      // on heavy projects (10–30s) and batching makes the sidebar wait the
      // full duration even though discover itself returns in ~2s.
      trpc: { context: { skipBatch: true } },
    },
  );

  // keepPreviousData is project-blind — without this guard it would surface
  // project A's facets while project B's discover request is in flight.
  // Record the project id of the most recent fresh (non-previous) response,
  // and treat anything older as a loading state.
  const dataProjectIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (query.isSuccess && !query.isPreviousData) {
      dataProjectIdRef.current = projectId;
    }
  }, [query.isSuccess, query.isPreviousData, projectId]);

  const isFromOtherProject = dataProjectIdRef.current !== projectId;

  return {
    data: isFromOtherProject ? EMPTY : (query.data ?? EMPTY),
    isLoading: query.isLoading || isFromOtherProject,
  };
}
