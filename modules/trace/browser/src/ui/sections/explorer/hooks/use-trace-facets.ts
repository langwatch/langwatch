import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useFilterStore } from "../../../../behavior/explorer.store.ts";
import { usePreviewTracesActive } from "../../../../behavior/explorer/onboarding/use-preview-traces-active.ts";
import { api, type RouterOutputs } from "../../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { SAMPLE_DISCOVER_DESCRIPTORS } from "../onboarding/data/sample-descriptors.ts";

const EMPTY: never[] = [];
const EMPTY_RESULT: { facets: never[]; pending: boolean } = {
  facets: EMPTY,
  pending: true,
};

type DiscoverResult = RouterOutputs["traces"]["discover"] | undefined;

// A project switch with no fresh response yet shows the skeleton, so project A's
// payload never bleeds into project B's render.
function pickFacetsResult({
  data,
  isFromOtherProject,
  isQueryLoading,
}: {
  data: DiscoverResult;
  isFromOtherProject: boolean;
  isQueryLoading: boolean;
}) {
  const liveSettled = data && !data.pending ? data : undefined;
  const result = isFromOtherProject ? EMPTY_RESULT : (liveSettled ?? data ?? EMPTY_RESULT);
  const isLoading = liveSettled ? false : isQueryLoading || isFromOtherProject || result.pending;
  return { result, isLoading };
}

export function useTraceFacets() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  // Sample-preview rows are a client-side fixture with no ClickHouse footprint, so the
  // real `discover` query returns nothing useful.
  const isSamplePreview = usePreviewTracesActive();

  const query = api.traces.discover.useQuery(
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
      // Discover used to carry a 10-min staleTime because SSE invalidation didn't
      // exist.
      staleTime: 0,
      // Keep prior facets visible across time-range / filter refetches so
      // the sidebar doesn't flicker. Project switches are gated below by
      // remembering which project the cached response belongs to.
      placeholderData: keepPreviousData,
      // needs a read hint: discover computed (a cold miss returns pending: true)
    },
  );

  // Live freshness is owned by useTraceFreshness, not here — this hook has several consumers, and
  // a subscription per consumer would open a duplicate SSE connection each.

  // keepPreviousData is project-blind — without this guard it would surface
  // project A's facets while project B's discover request is in flight.
  // Record the project id of the most recent fresh (non-previous) response,
  // and treat anything older as a loading state.
  const dataProjectIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (query.isSuccess && !query.isPlaceholderData) {
      dataProjectIdRef.current = projectId;
    }
  }, [query.isSuccess, query.isPlaceholderData, projectId]);

  // "Other project" only fires once a fresh response exists for a different project.
  const isFromOtherProject =
    dataProjectIdRef.current !== undefined && dataProjectIdRef.current !== projectId;

  const { result, isLoading } = pickFacetsResult({
    data: query.data,
    isFromOtherProject,
    isQueryLoading: query.isLoading,
  });

  if (isSamplePreview) {
    return { data: SAMPLE_DISCOVER_DESCRIPTORS, isLoading: false };
  }

  return {
    data: result.facets,
    isLoading,
  };
}
