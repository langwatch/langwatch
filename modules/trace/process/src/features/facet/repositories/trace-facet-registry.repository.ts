import type { FacetCatalog } from "../rules/trace-facet-registry.rules.ts";

/**
 * The facet registry the trace query compiler reads: each facet's expression
 * and the time column each of its tables is windowed on.
 */
export abstract class TraceFacetRegistryRepository {
  abstract getCatalog(): FacetCatalog;
}
