import { useMemo } from "react";

import { usePeriodSelector } from "~/components/PeriodSelector";

/**
 * The time window for widget queries, in epoch milliseconds.
 *
 * Two `Date`s for the same instant are never `Object.is`-equal, so a dependency
 * built on them would re-run the query on every render. This hook memoizes the
 * epoch-ms representation to keep dependencies stable.
 */
export function useWidgetTimeWindow() {
  const { period } = usePeriodSelector();

  return useMemo(
    () => ({
      start: period.startDate.getTime(),
      end: period.endDate.getTime(),
    }),
    [period.startDate, period.endDate],
  );
}
