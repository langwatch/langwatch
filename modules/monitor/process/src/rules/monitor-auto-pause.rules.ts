/**
 * What a monitor that paused itself says about why.
 * Spec: modules/monitor/specs/monitor-auto-pause.feature
 */

/** The whole percentage of runs that errored, rounded down so 89.9% never reads as 90%. */
function failureRatePercent({ runs, errors }: { runs: number; errors: number }): number {
  return Math.floor((errors / runs) * 100);
}

/** The reason stored on the monitor and shown beside it. */
export function monitorAutoPauseReason({
  runs,
  errors,
  topError,
}: {
  runs: number;
  errors: number;
  topError: string | null;
}): string {
  const rate = `${failureRatePercent({ runs, errors })}% of evaluations failed in the last hour (${errors} of ${runs})`;
  return topError ? `${rate}. Most common error: ${topError}` : rate;
}

/** Where a person opens the monitor, in its project's online evaluations. */
export function monitorDrawerPath(monitorId: string): string {
  return `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${encodeURIComponent(monitorId)}`;
}
