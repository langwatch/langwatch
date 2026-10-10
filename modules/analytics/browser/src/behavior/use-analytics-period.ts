/**
 * The window the charts are drawn over, memoised: calling the pure
 * `analytics-period` reader straight from render hands back a new `endDate`
 * every frame and refetches forever (see use-analytics-period.unit.test.ts).
 */

import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import { useCallback, useMemo } from "react";

import { useAnalyticsHost } from "../model/analytics-host.ts";
import {
  analyticsDaysDifference,
  readAnalyticsPeriod,
  type AnalyticsPeriod,
  type AnalyticsPeriodMode,
  type AnalyticsPresetKey,
} from "../model/analytics-period.ts";

export type AnalyticsPeriodState = {
  period: AnalyticsPeriod;
  mode: AnalyticsPeriodMode;
  /**
   * True while the address carries no range of its own, so `period` is this
   * hook's own fallback rather than something the reader asked for.
   */
  isDefault: boolean;
  daysDifference: number;
  setPeriod: (startDate: Instant, endDate: Instant) => void;
  setRelativePeriod: (presetKey: AnalyticsPresetKey) => void;
};

export function useAnalyticsPeriod(defaultNDays = 30): AnalyticsPeriodState {
  const host = useAnalyticsHost();
  const { query } = host.route();

  // Read once per render, and NEVER a dependency of the memo below.
  const now = nowInstant();
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
    (startDate: Instant, endDate: Instant) => {
      const validStart = Temporal.Instant.compare(startDate, endDate) > 0 ? endDate : startDate;

      // An absolute range and a preset are the same setting written two ways,
      // so setting one REMOVES the other. That is the whole reason the host's
      // write replaces the query rather than merging into it.
      host.setQuery({
        ...host.route().query,
        period: void 0,
        startDate: validStart.toString({ fractionalSecondDigits: 3 }),
        endDate: endDate.toString({ fractionalSecondDigits: 3 }),
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
