import type { FilterParam } from "../../hooks/useFilterParams";
import type { FilterField } from "../filters/types";

export const nonEmptyFilters = (
  filters: Partial<Record<FilterField, FilterParam>> | undefined
) => {
  if (!filters) {
    return [];
  }
  return Object.values(filters).filter((f) =>
    typeof f === "string"
      ? !!f
      : Array.isArray(f)
      ? f.length > 0
      : Object.keys(f).length > 0
  );
};
