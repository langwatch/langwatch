/**
 * The window the Results tab reads, and the rule that widens it.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import type { Period } from "@langwatch/analytics-browser-kit";
import { fromDate, nowInstant, subDays, type Instant } from "@langwatch/time";
import { useEffect } from "react";

import { widenedWindowDays } from "./run-plans.ts";

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
  setPeriod: (startDate: Instant, endDate: Instant) => void;
}): void {
  useEffect(() => {
    if (!planSlug || !lastRunTimestamp) return;
    if (lastRunTimestamp >= period.startDate.epochMilliseconds) return;
    const end = nowInstant();
    const now = end.epochMilliseconds;
    setPeriod(fromDate(subDays(now, widenedWindowDays(lastRunTimestamp, now))), end);
  }, [planSlug, lastRunTimestamp]); // eslint-disable-line react-hooks/exhaustive-deps
}
