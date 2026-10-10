/**
 * The templates library's search and chips, read from and written to the address so a
 * link opens the same view. Writes replace the history entry: typing is not a step back.
 */

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { type CatalogueFilters, NO_CATALOGUE_FILTERS } from "../model/catalogue-filter.ts";
import { templateFiltersFromQuery, templateFiltersQuery } from "../model/template-library.ts";

export function useTemplateLibraryFilters() {
  const host = useAnalyticsHost();
  const { query } = host.route();
  const filters = templateFiltersFromQuery(query);
  const setFilters = (next: CatalogueFilters) =>
    host.setQuery(templateFiltersQuery({ query, filters: next }), { replace: true });

  return {
    filters,
    setFilters,
    clearFilters: () => setFilters(NO_CATALOGUE_FILTERS),
  };
}
