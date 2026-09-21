import { useSearchParams } from "react-router";

/** The sort keys the per-person spend query accepts. */
export const SPEND_SORT_FIELDS = ["spend", "requests", "lastActivity"] as const;
export type SpendSortField = (typeof SPEND_SORT_FIELDS)[number];

export const isSpendSortField = (value: unknown): value is SpendSortField =>
  SPEND_SORT_FIELDS.some((field) => field === value);

/**
 * The people ranking's sort lives in the address (`?sort=requests`) so a
 * view is deep-linkable. The default (spend) stays out of it, and every
 * other parameter on the address (the selected tab, say) is preserved.
 */
export function useSpendSortParam(): {
  sortBy: SpendSortField;
  setSortBy: (next: SpendSortField) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("sort");
  const sortBy: SpendSortField = isSpendSortField(requested)
    ? requested
    : "spend";
  const setSortBy = (next: SpendSortField) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "spend") params.delete("sort");
        else params.set("sort", next);
        return params;
      },
      { replace: true },
    );
  return { sortBy, setSortBy };
}
