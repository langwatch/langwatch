/**
 * The predicate one facet is counted under: the active query with that
 * facet's own terms removed, so the facet keeps offering its other values
 * while the rest of the query applies. ADR-139.
 */

import { queryNamesFacet, queryWithoutFacet } from "@langwatch/trace-contract";

import type { TraceFilterWhere } from "./trace-filter-hidden-origins.rules.ts";

/** The facet a resolver is asked about: its key and the table it counts. */
export interface FacetFilterSubject {
  key: string;
  table: string;
}

export type FacetFilterResolver = (facet: FacetFilterSubject) => TraceFilterWhere | undefined;

/**
 * The per-facet predicate, compiled once per named facet field and once for
 * every facet the query does not name; facets sharing a compile share its
 * object. `hide` adds the origins the Explorer leaves out, which origin keeps.
 */
export function createFacetFilterResolver({
  queryText,
  compile,
  hide,
}: {
  queryText: string;
  compile: (text: string) => TraceFilterWhere | undefined;
  hide: (filter: TraceFilterWhere | undefined) => TraceFilterWhere | undefined;
}): FacetFilterResolver {
  const whole = compile(queryText);
  const byFacet = new Map<string, TraceFilterWhere | undefined>();
  const hidden = new Map<TraceFilterWhere | undefined, TraceFilterWhere | undefined>();
  const hasQuery = queryText.trim() !== "";

  const own = (facetKey: string): TraceFilterWhere | undefined => {
    if (!queryNamesFacet({ queryText, facetKey })) return whole;
    if (!byFacet.has(facetKey)) {
      byFacet.set(facetKey, compile(queryWithoutFacet({ queryText, facetKey })));
    }

    return byFacet.get(facetKey);
  };

  return (facet) => {
    const compiled = own(facet.key);
    if (facet.key === "origin") return compiled;
    // A facet on another table under no predicate would pay for a membership
    // test that excludes nothing but the hidden origins; without a query the
    // unfiltered count is what discover reads anyway.
    if (facet.table !== "trace_summaries" && !compiled && !hasQuery) return undefined;
    if (!hidden.has(compiled)) hidden.set(compiled, hide(compiled));

    return hidden.get(compiled);
  };
}
