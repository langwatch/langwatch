/**
 * The window the Results tab reads, and the rule that widens it.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { subDays } from "date-fns";
import { useEffect } from "react";
import type { Period } from "~/components/PeriodSelector";
import { widenedWindowDays } from "./run-plans";

/**
 * Widens the window until the last run of the plan being opened is inside it,
 * so a plan is never opened on an empty page while its runs exist.
 */
export function useWidenWindowForPlan({
  planSlug,
  lastRunTimestamp,
  period,
  setPeriod,
}: {
  planSlug: string | null;
  lastRunTimestamp: number | null;
  period: Period;
  setPeriod: (startDate: Date, endDate: Date) => void;
}): void {
  useEffect(() => {
    if (!planSlug || !lastRunTimestamp) return;
    if (lastRunTimestamp >= period.startDate.getTime()) return;
    const now = Date.now();
    setPeriod(
      subDays(new Date(now), widenedWindowDays(lastRunTimestamp, now)),
      new Date(now),
    );
  }, [planSlug, lastRunTimestamp]); // eslint-disable-line react-hooks/exhaustive-deps
}
