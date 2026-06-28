import { useFacetSearch } from "./useFacetSearch";

/**
 * Lazy-loads top distinct values for a single attribute key (e.g.
 * "langwatch.user_id"). Fetches only when `enabled` is true so collapsed
 * sections stay free.
 *
 * Thin delegation to {@link useFacetSearch}: an attribute key is just an
 * `attribute.`-prefixed facet. No prefix is passed — this surfaces the top
 * values, it does not search them — and the long staleTime keeps an expanded
 * section from refetching every time the rolling time range ticks (SSE
 * invalidates on real changes).
 */
export function useAttributeValues(attrKey: string, enabled: boolean) {
  return useFacetSearch({
    facetKey: `attribute.${attrKey}`,
    prefix: "",
    enabled,
    limit: 30,
    staleTimeMs: 5 * 60_000,
  });
}
