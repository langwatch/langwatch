import { usePeriodSelector } from "@langwatch/analytics-browser-kit";
import { toDate, type Instant } from "@langwatch/time";
import { useCallback } from "react";

/** The shared analytics selector still accepts Date at its boundary. */
export function useScenarioPeriod(defaultPeriodDays: number) {
  const { setPeriod: setAnalyticsPeriod, ...selection } = usePeriodSelector(defaultPeriodDays);
  const setPeriod = useCallback(
    (startDate: Instant, endDate: Instant) => {
      setAnalyticsPeriod(toDate(startDate), toDate(endDate));
    },
    [setAnalyticsPeriod],
  );

  return {
    period: selection.period,
    mode: selection.mode,
    setPeriod,
    setRelativePeriod: selection.setRelativePeriod,
  };
}
