import type { FilterParam } from "../../hooks/useFilterParams";
import type { FilterField } from "../filters/types";

const hasNonEmptyLeaf = (obj: FilterParam | string): boolean => {
  if (typeof obj === "string") return !!obj;
  if (Array.isArray(obj)) return obj.length > 0;
  return Object.values(obj).some((v) => hasNonEmptyLeaf(v as FilterParam));
};

export const filterOutEmptyFilters = (
  filters: Partial<Record<FilterField, FilterParam | string>> | undefined,
): Record<FilterField, FilterParam> => {
  if (!filters) {
    return {} as Record<FilterField, FilterParam>;
  }
  return Object.fromEntries(
    Object.entries(filters).filter(([_, f]) => hasNonEmptyLeaf(f)),
  ) as Record<FilterField, FilterParam>;
};
