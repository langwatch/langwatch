import { keepPreviousData } from "@tanstack/react-query";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { usePreviewTracesActive } from "../onboarding/hooks/usePreviewTracesActive";
import { useFilterStore } from "../stores/filterStore";
import type { DiscoverDescriptors } from "./discoverCache";

export interface FilteredTraceFacetsResult {
  /** Descriptors counted under the active query, or none until the first lands. */
  data: DiscoverDescriptors | undefined;
  /** A newer query's counts are in flight and `data` is the previous query's. */
  isPlaceholderData: boolean;
  isFetching: boolean;
  isError: boolean;
}

/**
 * The sidebar's counts: `tracesV2.facets` under the same input the list
 * reads (the debounced query, the exact window with its live flag), so a
 * number next to a value is what the table shows after selecting it.
 *
 * Cached only in React Query, keyed by that input, with the list's own
 * staleTime: a changed query or window is a new key, never a stale count.
 * `discover` keeps its shared cache because it feeds value lists and the
 * warm start, not the numbers.
 */
export function useFilteredTraceFacets(): FilteredTraceFacetsResult {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const isSamplePreview = usePreviewTracesActive();

  const query = api.tracesV2.facets.useQuery(
    {
      projectId: projectId ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
      query: queryText || undefined,
    },
    {
      enabled: !!projectId && !isSamplePreview,
      staleTime: 60_000,
      placeholderData: keepPreviousData,
      // The list is the slow read on heavy projects; batching the two would
      // make the sidebar wait on it.
      trpc: { context: { skipBatch: true } },
    },
  );

  return {
    data: query.data?.facets,
    isPlaceholderData: query.isPlaceholderData,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
