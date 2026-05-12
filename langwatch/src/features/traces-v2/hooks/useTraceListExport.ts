import { useExportTraces } from "~/components/messages/useExportTraces";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useFilterStore } from "../stores/filterStore";

/**
 * Adapter around `useExportTraces` that pulls filter/time/query state out of
 * the traces-v2 zustand stores instead of the legacy `useFilterParams`.
 *
 * Selection-aware callers pass `selectedTraceIds` to `openExportDialog()`;
 * "export all" callers pass nothing and the request uses the live query.
 */
export function useTraceListExport() {
  const { project } = useOrganizationTeamProject();
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);

  return useExportTraces({
    projectId: project?.id,
    filters: {},
    startDate: timeRange.from,
    endDate: timeRange.to,
    query: queryText || undefined,
  });
}
