import { keepPreviousData } from "@tanstack/react-query";

import { useFilterStore } from "../../../behavior/explorer.store.ts";
import { usePreviewTracesActive } from "../../../behavior/explorer/onboarding/use-preview-traces-active.ts";
import { api, type RouterOutputs } from "../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { useInstantEvalRuns } from "../../instant-eval/behavior/use-instant-eval-runs.ts";

type DiscoverDescriptors = RouterOutputs["traces"]["discover"]["facets"];

interface FilteredTraceFacetsResult {
  /** Descriptors counted under the active query, or none until the first lands. */
  data: DiscoverDescriptors | undefined;
  /** A newer query's counts are in flight and `data` is the previous query's. */
  isPlaceholderData: boolean;
  isFetching: boolean;
  isError: boolean;
}

/**
 * The sidebar's counts under the input the list reads; naming the query, empty
 * included, asks for counts rather than keys. `facetKeys` counts only those
 * facets (how a deferred facet loads); an empty list reads nothing.
 */
export function useFilteredTraceFacets({
  facetKeys,
}: { facetKeys?: readonly string[] } = {}): FilteredTraceFacetsResult {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const isSamplePreview = usePreviewTracesActive();
  const { evalRuns } = useInstantEvalRuns();

  const query = api.traces.discover.useQuery(
    {
      projectId: projectId ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
      query: queryText ?? "",
      ...(evalRuns ? { evalRuns } : {}),
      ...(facetKeys ? { facetKeys: [...facetKeys] } : {}),
    },
    {
      enabled: !!projectId && !isSamplePreview && facetKeys?.length !== 0,
      placeholderData: keepPreviousData,
    },
  );

  return {
    data: query.data?.facets,
    isPlaceholderData: query.isPlaceholderData,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
