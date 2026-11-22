import type { NotificationCadence } from "@langwatch/automation-contract";
import { nowInstant } from "@langwatch/time";
import { useMemo } from "react";

import { useDailyCap, useTracePreview } from "../../../behavior/use-automation-reads.ts";
import { type DailyCapAdvice, dailyCapAdvice, isPersistAction } from "../model/daily-cap-advice.ts";
import { estimateRatePerDay } from "../model/firing-rate.ts";

/** Shared with the Watch step's trace preview: one window, one sort, one set
 *  of cache options, so the two seats never reach different verdicts. */
export const PREVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PREVIEW_SORT = { columnId: "time", direction: "desc" as const };

/**
 * The ceiling advice for a step without the match preview on screen (ADR-093
 * §4: the Review step at create). Same two reads and the same `dailyCapAdvice`
 * decision as the Watch step. Advice only: a failed read produces no advice.
 */
export function useDailyCapAdvice({
  projectId,
  query,
  action,
  cadence,
  canBatch,
}: {
  projectId: string;
  /** The trace-filter query whose match rate the advice is about. */
  query: string | null;
  action: string | null | undefined;
  cadence: NotificationCadence;
  canBatch: boolean;
}): DailyCapAdvice | null {
  const trimmed = (query ?? "").trim();
  // Only the persist actions are governed by the ceiling.
  const isCapGoverned = !!projectId && trimmed.length > 0 && isPersistAction(action);

  const timeRange = useMemo(() => {
    const to = nowInstant().epochMilliseconds;
    return { from: to - PREVIEW_WINDOW_MS, to };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  const preview = useTracePreview({
    input: { projectId, timeRange, sort: PREVIEW_SORT, page: 1, pageSize: 5, query: trimmed },
    enabled: isCapGoverned,
  });

  const capStatus = useDailyCap({ projectId, enabled: isCapGoverned });

  return dailyCapAdvice({
    action,
    matchesPerDay:
      preview.data != null
        ? estimateRatePerDay({ matchesLast7Days: preview.data.totalHits, cadence, canBatch })
        : null,
    cap: capStatus.data?.cap ?? null,
  });
}
