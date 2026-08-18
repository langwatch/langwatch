import type { NotificationCadence } from "@langwatch/automations/cadences";
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "~/utils/api";
import {
  type DailyCapAdvice,
  dailyCapAdvice,
  isPersistAction,
} from "./dailyCapAdvice";
import { estimateRatePerDay } from "./firingRate";

/** Shared with the Watch step's `TraceQuerySubject`, which renders the same
 *  preview this hook only reads a count from — one window, one sort, one set
 *  of cache options, so the two seats can never drift into different
 *  verdicts for the same draft. */
export const PREVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PREVIEW_SORT = { columnId: "time", direction: "desc" as const };
export const PREVIEW_LIST_OPTIONS = {
  retry: false,
  // A long stale window plus keepPreviousData keeps the last result on
  // screen while a new query resolves; focus changes never refetch — the
  // matched set doesn't move fast enough to justify the flicker.
  staleTime: 5 * 60_000,
  placeholderData: keepPreviousData,
  refetchOnWindowFocus: false,
} as const;
export const DAILY_CAP_OPTIONS = {
  staleTime: 10 * 60 * 1000,
  retry: false,
  refetchOnWindowFocus: false,
} as const;

/**
 * The ceiling advice for a step that does not already have the match preview
 * on screen (ADR-093 §4: the Review step at create).
 *
 * The Watch step composes the same advice out of the preview it renders
 * anyway; this hook is for the caller that only wants the verdict, so it runs
 * the same two reads and hands back the same `dailyCapAdvice` decision. Both
 * seats therefore say one thing, decided in one place.
 *
 * Nothing here can gate anything: every read is allowed to fail, and a failure
 * simply produces no advice.
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
  // Only the persist actions are governed by the ceiling, so nothing else is
  // worth a round trip.
  const isCapGoverned =
    !!projectId && trimmed.length > 0 && isPersistAction(action);

  const timeRange = useMemo(() => {
    const to = Date.now();
    return { from: to - PREVIEW_WINDOW_MS, to };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  const preview = api.tracesV2.list.useQuery(
    {
      projectId,
      timeRange,
      sort: PREVIEW_SORT,
      page: 1,
      pageSize: 5,
      query: trimmed,
    },
    { enabled: isCapGoverned, ...PREVIEW_LIST_OPTIONS },
  );

  const capStatus = api.automation.getDailyCap.useQuery(
    { projectId },
    { enabled: isCapGoverned, ...DAILY_CAP_OPTIONS },
  );

  return dailyCapAdvice({
    action,
    matchesPerDay:
      preview.data != null
        ? estimateRatePerDay({
            matchesLast7Days: preview.data.totalHits,
            cadence,
            canBatch,
          })
        : null,
    cap: capStatus.data?.cap ?? null,
  });
}
