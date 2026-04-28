import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";

const EMPTY: { value: string; label?: string; count: number }[] = [];

/**
 * Lazy-loads top distinct values for a single attribute key (e.g. "langwatch.user_id").
 * Fetches only when `enabled` is true so collapsed sections stay free.
 */
export function useAttributeValues(attrKey: string, enabled: boolean) {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);

  const query = api.tracesV2.facetValues.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
      facetKey: `attribute.${attrKey}`,
      limit: 30,
      offset: 0,
    },
    {
      enabled: enabled && !!project?.id && !!attrKey,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );

  return {
    values: query.data?.values ?? EMPTY,
    totalDistinct: query.data?.totalDistinct ?? 0,
    isLoading: query.isLoading && enabled,
  };
}
