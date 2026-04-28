import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";
import { useViewStore } from "../stores/viewStore";

interface TraceListSnapshot {
  pageTraceIds: string[];
  totalHits: number;
}

const LENS_FILTERS: Readonly<Record<string, string>> = {
  errors: "status:error",
};

function buildEffectiveQuery(
  queryText: string,
  activeLensId: string,
): string | undefined {
  const lensFilter = LENS_FILTERS[activeLensId];
  if (!lensFilter) return queryText || undefined;
  if (!queryText) return lensFilter;
  return `${queryText} AND ${lensFilter}`;
}

/**
 * Read-only view of the trace list — same react-query cache as `useTraceList`,
 * without the freshness/newIds side effects. Use when you only need the IDs
 * and totals (e.g. bulk-action bar showing "N selected of M matching").
 */
export function useTraceListSnapshot(): TraceListSnapshot {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const sort = useViewStore((s) => s.sort);
  const activeLensId = useViewStore((s) => s.activeLensId);

  const effectiveQuery = useMemo(
    () => buildEffectiveQuery(queryText, activeLensId),
    [queryText, activeLensId],
  );

  const query = api.tracesV2.list.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
      sort: { columnId: sort.columnId, direction: sort.direction },
      page,
      pageSize,
      query: effectiveQuery,
    },
    {
      enabled: !!project?.id,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );

  return useMemo(
    () => ({
      pageTraceIds: (query.data?.items ?? []).map((t) => t.traceId),
      totalHits: query.data?.totalHits ?? 0,
    }),
    [query.data],
  );
}
