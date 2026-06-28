import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";

const EMPTY: { value: string; label?: string; count: number }[] = [];

/**
 * Server-side search over a single facet's distinct values.
 *
 * Queries `tracesV2.facetValues` with the typed `prefix` so a value can be
 * found among ALL of a facet's distinct values — not just the preloaded
 * top-N the discover payload shipped. This is what lets a high-cardinality
 * facet (models, users, services, trace names, labels) surface a value
 * beyond #50.
 *
 * Server search is categorical-only (this is the canonical statement of that
 * rule — callers just point here): valid for CATEGORICAL facets (and
 * `attribute.*`), because `facetValues` throws for range facets. Callers
 * therefore gate `enabled` — the sidebar passes it only from the categorical
 * render branch (`serverValueSearch`); the value picker only once the resolved
 * descriptor is categorical.
 *
 * Also the shared engine behind {@link useAttributeValues}, which delegates
 * here with no prefix to lazy-load an attribute's top values.
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
      keepPreviousData: true,
    },
  );

  return {
    values: query.data?.values ?? EMPTY,
    totalDistinct: query.data?.totalDistinct ?? 0,
    isLoading: query.isLoading && enabled,
  };
}
