import { keepPreviousData } from "@tanstack/react-query";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { api } from "../../trace-api";
import { useFilterStore } from "../../../../index";

const EMPTY: { value: string; label?: string; count: number }[] = [];

/**
 * Server-side search over a single facet's distinct values.
 */
export function useFacetSearch({
  facetKey,
  prefix,
  enabled,
  limit = 100,
  staleTimeMs = 60_000,
}: {
  /** Facet to search — identity-mapped to the server's `facetKey`. */
  facetKey: string;
  /** Raw search text; trimmed, and omitted entirely when blank. */
  prefix: string;
  /** Caller's gate (e.g. search open + non-empty query). ANDed with the
   *  project + facetKey guards below. */
  enabled: boolean;
  /** Max distinct values to return (the server caps at 1000). */
  limit?: number;
  /** How long results stay fresh — distinct values turn over slowly, and SSE
   *  invalidates on real changes. */
  staleTimeMs?: number;
}) {
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
      facetKey,
      prefix: prefix.trim() || undefined,
      limit,
      offset: 0,
    },
    {
      enabled: enabled && !!project?.id && !!facetKey,
      staleTime: staleTimeMs,
      placeholderData: keepPreviousData,
    },
  );

  return {
    values: query.data?.values ?? EMPTY,
    totalDistinct: query.data?.totalDistinct ?? 0,
    isLoading: query.isLoading && enabled,
    // `keepPreviousData` keeps `isLoading` true only on the COLD first fetch, so
    // refinement keystrokes (which refetch while prior values stay on screen)
    // need `isFetching` to drive the "Searching all values…" spinner. Exposed
    // ALONGSIDE `isLoading` — useAttributeValues / AttributeKeyRow rely on the
    // latter, so it stays.
    isFetching: (query.isFetching ?? false) && enabled,
  };
}
