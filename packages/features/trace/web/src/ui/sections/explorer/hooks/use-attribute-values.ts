import { useFacetSearch } from "./use-facet-search";

/**
 * Lazy-loads top distinct values for a single attribute key (e.g. "langwatch.user_id").
 * Fetches only when `enabled` is true so collapsed sections stay free.
 */
export function useAttributeValues({
  attrKey,
  enabled,
  filterPrefix = "attribute",
}: {
  attrKey: string;
  enabled: boolean;
  filterPrefix?: string;
}) {
  return useFacetSearch({
    facetKey: `${filterPrefix}.${attrKey}`,
    prefix: "",
    enabled: enabled && attrKey.length > 0,
    limit: 30,
    staleTimeMs: 5 * 60_000,
  });
}
