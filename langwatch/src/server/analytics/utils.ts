import type { FilterParam } from "../../hooks/useFilterParams";
import type { FilterField } from "../filters/types";

export const filterOutEmptyFilters = (
  filters: Partial<Record<FilterField, FilterParam | string>> | undefined,
): Record<FilterField, FilterParam> => {
  if (!filters) {
    return {} as Record<FilterField, FilterParam>;
  }
  return Object.fromEntries(
    Object.entries(filters).filter(([_, f]) => {
      if (f == null) return false;
      if (typeof f === "string") return !!f;
      if (Array.isArray(f)) return f.length > 0;
      // Shallow check: keep objects with keys even if leaf arrays are empty.
      // { "eval-1": [] } means "key selected, sub-values pending" and must
      // be preserved so the nested filter UI can render the sub-options.
      return Object.keys(f).length > 0;
    }),
  ) as Record<FilterField, FilterParam>;
};
