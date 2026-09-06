import type { ExpressionCategoricalDef, FacetDefinition } from "@langwatch/trace-server";

/** Whether a categorical facet definition is computed from an expression rather than a bare key. */
export function isExpressionCategorical(def: FacetDefinition): def is ExpressionCategoricalDef {
  return def.kind === "categorical" && "expression" in def;
}
