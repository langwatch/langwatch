import { useCallback, useMemo } from "react";
import { useTraceFacets } from "./useTraceFacets";

/**
 * Resolve a facet `field:value` pair to its human label using the same
 * discover payload the filter sidebar renders from (e.g. evaluator
 * `monitor_0005…` → "Ragas Response Relevancy"). Returns undefined when
 * the value has no richer label — callers should fall back to the raw
 * value. Backed by the shared `discover` React Query cache, so this
 * costs no extra request.
 */
export function useFacetValueLabelResolver(): (
  field: string,
  value: string,
) => string | undefined {
  const { data } = useTraceFacets();

  const labelByFieldValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const facet of data ?? []) {
      if (facet.kind !== "categorical") continue;
      for (const tv of facet.topValues) {
        if (tv.label && tv.label !== tv.value) {
          map.set(`${facet.key}|${tv.value}`, tv.label);
        }
      }
    }
    return map;
  }, [data]);

  return useCallback(
    (field: string, value: string) => labelByFieldValue.get(`${field}|${value}`),
    [labelByFieldValue],
  );
}
