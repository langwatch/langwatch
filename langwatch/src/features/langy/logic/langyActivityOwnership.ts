import type { LangyProgressSample } from "../stores/langyStore";

/**
 * One piece of work gets one visible progress owner.
 *
 * A pending capability card is more specific than the global turn status, so
 * it owns the label, progress bar, measured count, and the wave's travelling
 * status pulse for as long as it is present. Metrics remain global because
 * they describe the whole turn rather than the one capability call.
 */
export function resolveLangyActivityOwnership({
  hasInlineProgressOwner,
  turnInFlight,
  status,
  progress,
  progressSample,
  metricsCount,
}: {
  hasInlineProgressOwner: boolean;
  turnInFlight: boolean;
  status: string | null | undefined;
  progress: number | null | undefined;
  progressSample: LangyProgressSample | null | undefined;
  metricsCount: number;
}) {
  return {
    standaloneStatus: hasInlineProgressOwner ? null : status,
    standaloneProgress: hasInlineProgressOwner ? null : progress,
    standaloneProgressSample: hasInlineProgressOwner ? null : progressSample,
    showStandaloneSignals: !hasInlineProgressOwner || metricsCount > 0,
    waveStatusActive:
      turnInFlight &&
      !hasInlineProgressOwner &&
      !!status &&
      status.trim().length > 0,
  };
}

export function formatLangyProgressCount({
  current,
  total,
}: Pick<LangyProgressSample, "current" | "total">): string {
  return `${current.toLocaleString()} of ${total.toLocaleString()}`;
}

export function formatLangyPreviewCount({
  loadedCount,
  totalCount,
}: {
  loadedCount: number;
  totalCount: number | null;
}): string {
  return totalCount !== null
    ? `${totalCount.toLocaleString()} matches · ${loadedCount.toLocaleString()} shown`
    : `${loadedCount.toLocaleString()} shown so far`;
}
