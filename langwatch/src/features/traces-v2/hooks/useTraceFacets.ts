import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";

const EMPTY: never[] = [];

export function useTraceFacets() {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);

  const query = api.tracesV2.discover.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: { from: timeRange.from, to: timeRange.to, live: !!timeRange.label },
    },
    {
      enabled: !!project?.id,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );

  return {
    data: query.data ?? EMPTY,
    isLoading: query.isLoading,
  };
}
