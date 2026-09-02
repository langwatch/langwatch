/**
 * The dashboard widget's request orchestration: when to run a saved chart, and
 * which settled response the card is allowed to draw.
 *
 * `run` is a mutation because executing SQL is not a cacheable read, so this
 * hook drives it from an effect rather than getting react-query's own
 * fetch-on-change. The ref carries the last request actually issued so that a
 * re-render with the same period and step does not re-execute.
 *
 * The sequence numbers answer the question "which request does the rendered
 * outcome belong to". A period drag fires a run per intermediate window, and
 * nothing orders the responses: a query over a narrow window can resolve after
 * one over a wide window issued later, leaving the card showing an answer for
 * a period the dashboard is no longer on — with no spinner and nothing on
 * screen saying so. Each issued request takes the next sequence number, and a
 * resolution — success or failure alike — is kept only when it carries the
 * latest one, so a straggler is dropped rather than winning by arriving last.
 * Failures ride the same guard as answers: a stale error settling last must
 * not replace the fresh answer already on screen.
 *
 * @see ../components/LangWatchQLDashboardWidget.tsx — the card this drives
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { useEffect, useRef, useState } from "react";

import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";
import { analyticsApi } from "./analytics-api";

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
}

export function useLangWatchQLWidgetRun({
  chartId,
  projectId,
  isChartLoaded,
  start,
  end,
  granularitySeconds,
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

  const requestKey = `${chartId}:${projectId}:${start}:${end}:${granularitySeconds}`;

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
