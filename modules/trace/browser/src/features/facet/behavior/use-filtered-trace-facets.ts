import { keepPreviousData } from "@tanstack/react-query";

import { useFilterStore } from "../../../behavior/explorer.store.ts";
import { usePreviewTracesActive } from "../../../behavior/explorer/onboarding/use-preview-traces-active.ts";
import { api, type RouterOutputs } from "../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { useHasPendingNegatedEval } from "../../instant-eval/behavior/use-has-pending-negated-eval.ts";
import { useInstantEvalRuns } from "../../instant-eval/behavior/use-instant-eval-runs.ts";

type DiscoverDescriptors = RouterOutputs["traces"]["discover"]["facets"];

interface FilteredTraceFacetsResult {
  /** Descriptors counted under the active query, or none until the first lands. */
  data: DiscoverDescriptors | undefined;
  /** A newer query's counts are in flight and `data` is the previous query's. */
  isPlaceholderData: boolean;
  isFetching: boolean;
  isError: boolean;
  /** The query matches no trace yet (a pending NOT eval chip): every count is zero. */
  matchesNothing: boolean;
}

/**
 * The sidebar's counts: `traces.discover` under the input the list reads, so a
 * number beside a value is what the table shows after selecting it. Naming the
 * query — empty string included — is what asks for counts rather than keys.
 */
export function useFilteredTraceFacets(): FilteredTraceFacetsResult {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const isSamplePreview = usePreviewTracesActive();
  const { evalRuns } = useInstantEvalRuns();
  // A pending NOT chip's rows are not results yet, as in the table: count none.
  const hasPendingNegatedEval = useHasPendingNegatedEval();

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
    },
    {
      enabled: !!projectId && !isSamplePreview && !hasPendingNegatedEval,
      placeholderData: keepPreviousData,
    },
  );

  // Settled, as a read matching no trace: the rail shows no counts, not a pending read.
  if (hasPendingNegatedEval) {
    return {
      data: [],
      isPlaceholderData: false,
      isFetching: false,
      isError: false,
      matchesNothing: true,
    };
  }
  return {
    data: query.data?.facets,
    isPlaceholderData: query.isPlaceholderData,
    isFetching: query.isFetching,
    isError: query.isError,
    matchesNothing: false,
  };
}
