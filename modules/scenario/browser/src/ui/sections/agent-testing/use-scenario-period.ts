import { usePeriodSelector } from "../../../behavior/analytics/use-period-selector.ts";

/** The window the Results and Cases tabs read, from the shared analytics selector. */
export function useScenarioPeriod(defaultPeriodDays: number) {
  const { period, mode, setPeriod, setRelativePeriod } = usePeriodSelector(defaultPeriodDays);

  return { period, mode, setPeriod, setRelativePeriod };
}
