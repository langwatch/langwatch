import type {
  ExpressionCategoricalDef,
  FacetDefinition,
} from "#features/facet/rules/trace-facet-registry.rules";

/** Whether a categorical facet definition is computed from an expression rather than a bare key. */
export function isExpressionCategorical(def: FacetDefinition): def is ExpressionCategoricalDef {
  return def.kind === "categorical" && "expression" in def;
}

/** Whether a facet's values are read only when asked for by key. */
export function isDeferredFacet(def: FacetDefinition): def is ExpressionCategoricalDef {
  return isExpressionCategorical(def) && def.deferred === true;
}

/**
 * The facets one read counts: the named ones when keys are given, deferred
 * facets included; otherwise every facet but the deferred ones.
 */
export function selectFacetsToRead({
  registry,
  facetKeys,
}: {
  registry: readonly FacetDefinition[];
  facetKeys?: readonly string[];
}): FacetDefinition[] {
  if (facetKeys) return registry.filter((def) => facetKeys.includes(def.key));
  return registry.filter((def) => !isDeferredFacet(def));
}
