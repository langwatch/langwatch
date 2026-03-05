/** Time in milliseconds after which a run without updates is considered interrupted */
export const INTERRUPTED_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a run is finished based on timestamps.
 * A run is considered finished if it has finishedAt, stoppedAt,
 * or hasn't been updated in 5 minutes (interrupted).
 */
export const isRunFinished = (timestamps: {
  finishedAt?: number | null;
  stoppedAt?: number | null;
  updatedAt?: number | null;
}): boolean => {
  // Explicitly finished or stopped
  if (timestamps.finishedAt ?? timestamps.stoppedAt) {
    return true;
  }

  // Consider interrupted if no updates for 5 minutes
  if (timestamps.updatedAt) {
    const timeSinceUpdate = Date.now() - timestamps.updatedAt;
    if (timeSinceUpdate > INTERRUPTED_THRESHOLD_MS) {
      return true;
    }
  }

  return false;
};
