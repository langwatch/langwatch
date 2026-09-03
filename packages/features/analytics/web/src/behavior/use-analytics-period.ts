/**
 * The window the charts are drawn over, and the render seam that memoises it.
 *
 * `model/analytics-period.ts` is pure and takes `now`. THAT IS WHY THIS FILE
 * EXISTS. A relative window ends at the instant it is read, so calling the
 * reader straight out of a render body hands back a new `endDate` every frame —
 * and every analytics read keys on `{ startDate, endDate }`, so the page would
 * refetch on every render, forever. The annotations family shipped exactly that
 * bug into a test worker that walked to a four-gigabyte ceiling with no failing
 * assertion; `use-analytics-period.unit.test.ts` pins the referential stability
 * so it cannot come back here.
 *
 * `now` is deliberately outside the memo's dependencies. A remount — a refresh,
 * a route change, a project switch — gets a fresh anchor for free, and nothing
 * else moves the window.
 */

import { useCallback, useMemo } from "react";

import { useAnalyticsHost } from "../model/analytics-host";
import {
  analyticsDaysDifference,
  readAnalyticsPeriod,
  type AnalyticsPeriod,
  type AnalyticsPeriodMode,
  type AnalyticsPresetKey,
} from "../model/analytics-period";

export type AnalyticsPeriodState = {
  period: AnalyticsPeriod;
  mode: AnalyticsPeriodMode;
  /**
   * True while the address carries no range of its own, so `period` is this
   * hook's own fallback rather than something the reader asked for.
   */
  isDefault: boolean;
  daysDifference: number;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (presetKey: AnalyticsPresetKey) => void;
};

export function useAnalyticsPeriod(defaultNDays = 30): AnalyticsPeriodState {
  const host = useAnalyticsHost();
  const { query } = host.route();

  // Read once per render, and NEVER a dependency of the memo below.
  const now = new Date();
  const queryPeriod = query.period;
  const queryStartDate = query.startDate;
  const queryEndDate = query.endDate;

  const reading = useMemo(
    () =>
      readAnalyticsPeriod({
        query: {
          ...(queryPeriod === void 0 ? {} : { period: queryPeriod }),
          ...(queryStartDate === void 0 ? {} : { startDate: queryStartDate }),
          ...(queryEndDate === void 0 ? {} : { endDate: queryEndDate }),
        },
        now,
        defaultNDays,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryPeriod, queryStartDate, queryEndDate, defaultNDays],
  );

  const setPeriod = useCallback(
    (startDate: Date, endDate: Date) => {
      const validEnd = endDate instanceof Date && !isNaN(endDate.getTime()) ? endDate : new Date();
      let validStart =
        startDate instanceof Date && !isNaN(startDate.getTime()) ? startDate : new Date();
      if (validStart > validEnd) validStart = validEnd;

      // An absolute range and a preset are the same setting written two ways,
      // so setting one REMOVES the other. That is the whole reason the host's
      // write replaces the query rather than merging into it.
      host.setQuery({
        ...host.route().query,
        period: void 0,
        startDate: validStart.toISOString(),
        endDate: validEnd.toISOString(),
      });
    },
    [host],
  );

  const setRelativePeriod = useCallback(
    (presetKey: AnalyticsPresetKey) => {
      host.setQuery({
        ...host.route().query,
        startDate: void 0,
        endDate: void 0,
        period: presetKey,
      });
    },
    [host],
  );

  return {
    period: reading.period,
    mode: reading.mode,
    isDefault: reading.isDefault,
    daysDifference: analyticsDaysDifference(reading.period.startDate, reading.period.endDate),
    setPeriod,
    setRelativePeriod,
  };
}
