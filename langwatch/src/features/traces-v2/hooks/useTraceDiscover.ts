import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";
import type { FacetDescriptor } from "~/server/app-layer/traces/trace-list.service";

interface DiscoverResult {
  data: FacetDescriptor[];
  isLoading: boolean;
}

export function useTraceDiscover(): DiscoverResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.timeRange);

  const query = api.tracesV2.discover.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: { from: timeRange.from, to: timeRange.to, live: !!timeRange.label },
    },
    {
      enabled: !!project?.id,
      staleTime: 60_000,
    },
  );

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
  };
}
