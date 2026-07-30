/** Time in milliseconds after which a run is considered interrupted (see BatchRunsSidebar's own staleness indicator). */
export const INTERRUPTED_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * A run is finished when it carries an explicit terminal timestamp, or when
 * its derived progress has reached its total — the same reading `progress`
 * itself comes from (ADR-103 decision 4), never a wall-clock guess.
 */
export const isRunFinished = (run: {
  finishedAt?: number | null;
  stoppedAt?: number | null;
  progress?: number | null;
  total?: number | null;
}): boolean => {
  if (run.finishedAt ?? run.stoppedAt) {
    return true;
  }

  return run.progress != null && run.total != null && run.progress >= run.total;
};
