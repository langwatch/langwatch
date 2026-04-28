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
      staleTime: 30_000,
      // Keep prior facets visible across time-range / filter refetches so
      // the sidebar doesn't flicker. Project switches are gated below by
      // remembering which project the cached response belongs to.
      keepPreviousData: true,
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
