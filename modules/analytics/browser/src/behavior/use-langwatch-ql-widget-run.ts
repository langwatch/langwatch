/**
 * The dashboard widget's request orchestration: when to run a saved chart, and which settled
 * response the card may draw. Nothing orders responses, so each request takes the next
 * sequence number; only a resolution carrying the latest one is kept, so a straggler is dropped.
 */

import { useEffect, useRef, useState } from "react";

import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";
import { analyticsApi } from "./analytics-api.ts";

export interface UseLangWatchQLWidgetRunInput {
  readonly chartId: string;
  readonly projectId: string;
  /** The saved chart definition has loaded; nothing runs before it has. */
  readonly isChartLoaded: boolean;
  /** Period start, epoch milliseconds. */
  readonly start: number;
  /** Period end, epoch milliseconds. */
  readonly end: number;
  /** The datapoint step to request — one of the offered steps. */
  readonly granularitySeconds: LangWatchQLGranularityStep;
  /**
   * The dashboard's last scheduled refresh (epoch ms). A new value re-runs
   * the chart even though nothing about the request itself changed.
   */
  readonly refreshedAt?: number;
}

export function useLangWatchQLWidgetRun({
  chartId,
  projectId,
  isChartLoaded,
  start,
  end,
  granularitySeconds,
  refreshedAt,
}: UseLangWatchQLWidgetRunInput) {
  const run = analyticsApi.analytics.savedWorkbenchCharts.run.useMutation();
  const { mutate } = run;

  // Derived from the mutation rather than re-declared, so the widget cannot
  // drift from the shape the procedure actually returns.
  type RunResult = NonNullable<typeof run.data>;
  type Settled =
    | { readonly sequence: number; readonly result: RunResult }
    | { readonly sequence: number; readonly error: unknown };

  const lastRequest = useRef<string | null>(null);
  const issuedRequests = useRef(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  const requestKey = `${chartId}:${projectId}:${start}:${end}:${granularitySeconds}:${refreshedAt ?? ""}`;

  useEffect(() => {
    if (!isChartLoaded) return;
    if (lastRequest.current === requestKey) return;
    lastRequest.current = requestKey;

    issuedRequests.current += 1;
    const sequence = issuedRequests.current;

    // Strictly-newer rather than equal, so an outcome already on screen is
    // never replaced by an older one that resolved late.
    const settle = (outcome: Settled) => {
      setSettled((current) =>
        current !== null && current.sequence > outcome.sequence ? current : outcome,
      );
    };

    mutate(
      {
        id: chartId,
        projectId,
        timeWindow: { start, end },
        granularitySeconds,
        // The whole reason this surface differs from the workbench: the
        // widget does not own the period, so it asks the run to coarsen
        // rather than refuse. See the widget's module docblock.
        onBudgetOverflow: "coarsen",
      },
      {
        onSuccess: (data) => settle({ sequence, result: data }),
        onError: (error) => settle({ sequence, error }),
      },
    );
  }, [isChartLoaded, requestKey, mutate, chartId, projectId, start, end, granularitySeconds]);

  return {
    result: settled !== null && "result" in settled ? settled.result : undefined,
    error: settled !== null && "error" in settled ? settled.error : undefined,
  };
}
