import { useRouter } from "@langwatch/browser-host/use-router";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import { useCallback, useMemo } from "react";

import {
  getDaysDifference,
  readPeriodFromAddress,
  type RelativePresetKey,
} from "../../model/analytics/period.ts";

export const usePeriodSelector = (defaultNDays = 30) => {
  const router = useRouter();

  // Recompute on every render so relative windows stay anchored to "now".
  // The useMemo below excludes `now` from its deps, so the returned `period`
  // stays referentially stable across renders unless query params change.
  // Page re-mounts (refresh, route change) get a fresh `now` for free.
  const now = nowInstant();

  const queryPeriod = router.query.period;
  const queryStartDate = router.query.startDate;
  const queryEndDate = router.query.endDate;

  const { period, mode, isDefault } = useMemo(
    () =>
      readPeriodFromAddress({
        defaultNDays,
        now,
        queryEndDate,
        queryPeriod,
        queryStartDate,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryPeriod, queryStartDate, queryEndDate, defaultNDays],
  );

  const setPeriod = useCallback(
    (startDate: Instant, endDate: Instant) => {
      const validStartDate = Temporal.Instant.compare(startDate, endDate) > 0 ? endDate : startDate;

      const { period: _omitPeriod, ...rest } = router.query;
      void router.push(
        {
          query: {
            ...rest,
            startDate: validStartDate.toString({ fractionalSecondDigits: 3 }),
            endDate: endDate.toString({ fractionalSecondDigits: 3 }),
          },
        },
        { shallow: true },
      );
    },
    [router],
  );

  const setRelativePeriod = useCallback(
    (presetKey: RelativePresetKey) => {
      const { startDate: _s, endDate: _e, ...rest } = router.query;
      void router.push(
        {
          query: {
            ...rest,
            period: presetKey,
          },
        },
        { shallow: true },
      );
    },
    [router],
  );

  const daysDifference = getDaysDifference(period.startDate, period.endDate);

  return {
    period,
    mode,
    /**
     * True while the URL carries no range of its own, so `period` is this hook's own fallback
     * rather than something the reader asked for. Surfaces where a default window would hide
     * rows read this to filter only once a range has actually been picked.
     */
    isDefault,
    setPeriod,
    setRelativePeriod,
    daysDifference,
  };
};
