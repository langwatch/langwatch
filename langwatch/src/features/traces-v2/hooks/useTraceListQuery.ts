import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { shouldShowArrivals } from "../components/EmptyState/onboardingJourneyConfig";
import {
  ARRIVAL_PREVIEW_TRACES,
  SAMPLE_PREVIEW_TRACES,
} from "../components/EmptyState/samplePreviewTraces";
import { useFilterStore } from "../stores/filterStore";
import { useOnboardingStageStore } from "../stores/onboardingStageStore";
import { useViewStore } from "../stores/viewStore";
import type { TraceEvalResult, TraceListItem } from "../types/trace";
import { usePreviewTracesActive } from "./usePreviewTracesActive";

export interface TraceListQueryResult {
  data: TraceListItem[];
  totalHits: number;
  isLoading: boolean;
  isFetching: boolean;
  isPreviousData: boolean;
  isFetched: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * Pure tRPC + mapping layer. The lens's saved filter is encoded into
 * `filterStore.queryText` when the lens is selected, so this hook only has
 * to forward queryText, sort, page, and time range — no per-lens special-casing.
 */
export function useTraceListQuery(): TraceListQueryResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const sort = useViewStore((s) => s.sort);
  const previewActive = usePreviewTracesActive();
  const onboardingStage = useOnboardingStageStore((s) => s.stage);

  // While the project has no real traces and the user hasn't dismissed
  // the onboarding card, we serve `SAMPLE_PREVIEW_TRACES` from local
  // memory instead of hitting tRPC. This lets the empty state read as
  // a populated, interactive product (filters, density, drawer-open,
  // facets) without requiring a token, an OTel send, or any DB round
  // trip. Skipping the API call entirely (rather than calling and
  // discarding) saves a request per nav into Traces for new projects.
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
      query: queryText || undefined,
    },
    {
      enabled: !!project?.id && !previewActive,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );

  const data = useMemo<TraceListItem[]>(() => {
    if (!query.data) return [];
    const evalMap = (query.data.evaluations ?? {}) as Record<
      string,
      TraceEvalResult[]
    >;
    return (query.data.items as TraceListItem[]).map((item) => ({
      ...item,
      spanCount: item.spanCount ?? 0,
      evaluations: (evalMap[item.traceId] ?? []).map((e) => ({
        evaluatorId: e.evaluatorId,
        evaluatorName: e.evaluatorName,
        status: e.status,
        score: e.score,
        passed: e.passed,
        label: e.label,
      })),
      events: item.events ?? [],
    }));
  }, [query.data]);

  if (previewActive) {
    // The journey config (`onboardingJourneyConfig.ts`) declares
    // which stages should mix the held-back arrival fixtures into
    // the visible set. Their `ageMin` values are deliberately tiny
    // so they sort to the top of the table by timestamp without
    // us having to touch the sort logic — the user sees them appear
    // at row 1/2, which is exactly what "two new traces just
    // arrived" should look like.
    const arrivalsVisible = shouldShowArrivals(onboardingStage);
    const previewSet = arrivalsVisible
      ? [...ARRIVAL_PREVIEW_TRACES, ...SAMPLE_PREVIEW_TRACES]
      : SAMPLE_PREVIEW_TRACES;
    return {
      data: filterPreviewTraces(previewSet, queryText),
      totalHits: previewSet.length,
      isLoading: false,
      isFetching: false,
      isPreviousData: false,
      isFetched: true,
      isError: false,
      error: null,
    };
  }

  return {
    data,
    totalHits: query.data?.totalHits ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPreviousData: query.isPreviousData,
    isFetched: query.isFetched,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Tiny client-side filter for the sample preview set so the user's
 * search/facet input still feels alive while they're exploring. We
 * deliberately don't try to mirror the server's full query AST — this
 * is a teaching surface, not a faithful execution. A loose substring
 * match across the fields a user is most likely to type into the bar
 * (name, model, service, IDs) is enough to make the bar feel
 * responsive without inventing a parser. Empty/whitespace returns the
 * full set.
 */
function filterPreviewTraces(
  traces: readonly TraceListItem[],
  queryText: string,
): TraceListItem[] {
  const trimmed = queryText.trim().toLowerCase();
  if (!trimmed) return [...traces];
  return traces.filter((t) => {
    const haystack = [
      t.name,
      t.serviceName,
      t.rootSpanType ?? "",
      ...(t.models ?? []),
      t.userId ?? "",
      t.conversationId ?? "",
      t.input ?? "",
      t.output ?? "",
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}
