import type { FilterParam } from "../../hooks/useFilterParams";
import type { FilterField } from "../filters/types";

export const filterOutEmptyFilters = (
  filters: Partial<Record<FilterField, FilterParam>> | undefined
): Record<FilterField, FilterParam> => {
  if (!filters) {
    return {} as Record<FilterField, FilterParam>;
  }
  return Object.fromEntries(
    Object.entries(filters).filter(([_, f]) =>
      typeof f === "string"
        ? !!f
        : Array.isArray(f)
        ? f.length > 0
        : Object.keys(f).length > 0
    )
  ) as Record<FilterField, FilterParam>;
};
