import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { FacetValuesResult } from "~/server/app-layer/traces/trace-list.service";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";

interface FacetValuesOptions {
  facetKey: string;
  prefix?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}

interface FacetValuesQueryResult {
  data: FacetValuesResult | undefined;
  isLoading: boolean;
  isFetching: boolean;
}

export function useTraceFacetValues({
  facetKey,
  prefix,
  limit = 50,
  offset = 0,
  enabled = true,
}: FacetValuesOptions): FacetValuesQueryResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.timeRange);

  const query = api.tracesV2.facetValues.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
      facetKey,
      prefix,
      limit,
      offset,
    },
    {
      enabled: !!project?.id && enabled,
      staleTime: 30_000,
    },
  );

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
