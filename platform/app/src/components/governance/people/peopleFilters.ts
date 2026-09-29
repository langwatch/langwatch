/**
 * The People page's filter state, and the one window it does not offer.
 *
 * The department choice lives in the address so a view is deep-linkable, and
 * its default stays out of it — the same rule the sort already followed
 * (`useSpendSortParam`).
 *
 * THE WINDOW. The page used to carry a time-frame chip, and it did not
 * correlate to what the table shows: half the rows come from the identity feed,
 * which has no window at all, so narrowing the frame moved some rows and left
 * others exactly where they were. The chip is gone. The spend read still takes
 * a window in days — it has no unbounded mode — so it is asked for
 * `SPEND_WINDOW_DAYS`, a fixed year, and the page states that window in words
 * rather than implying the reader chose it.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */

import { useSearchParams } from "react-router";

/**
 * The window `activityMonitor.spendByUser` is asked for. A year, which is also
 * the longest that read accepts: governance is read at a governance cadence,
 * and the read refuses anything wider.
 */
export const SPEND_WINDOW_DAYS = 365;

/** How the page names that window to a reader. */
export const SPEND_WINDOW_LABEL = "last 12 months";

export interface PeopleFilters {
  /** `null` is every department, including the people who have none. */
  department: string | null;
  setDepartment: (next: string | null) => void;
}

/**
 * The department choice, read from and written to the address. The sort keeps
 * its own hook because the detail listing page shares it.
 */
export function usePeopleFilters(): PeopleFilters {
  const [searchParams, setSearchParams] = useSearchParams();

  const department = searchParams.get("department");

  return {
    department,
    setDepartment: (next) =>
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next === null || next === "") params.delete("department");
          else params.set("department", next);
          return params;
        },
        { replace: true },
      ),
  };
}
