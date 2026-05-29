// Experiment runs are stored as a timestamp-driven state in ClickHouse: a run
// is "completed" once finishedAt is set, "stopped" once stoppedAt is set, and
// otherwise still "running". A run that stopped emitting updates a while ago
// without ever finishing is reported as "interrupted": the SDK process likely
// died before sending finished_at/stopped_at.

export const INTERRUPTED_THRESHOLD_MS = 5 * 60 * 1000;

export type RunStatus = "completed" | "stopped" | "running" | "interrupted";

export interface RunTimestamps {
  createdAt?: number | null;
  updatedAt?: number | null;
  finishedAt?: number | null;
  stoppedAt?: number | null;
}

export const deriveRunStatus = (
  timestamps: RunTimestamps,
  now: number = Date.now(),
): RunStatus => {
  if (timestamps.stoppedAt != null) return "stopped";
  if (timestamps.finishedAt != null) return "completed";
  if (
    timestamps.updatedAt != null &&
    now - timestamps.updatedAt > INTERRUPTED_THRESHOLD_MS
  ) {
    return "interrupted";
  }
  return "running";
};

export const isTerminalStatus = (status: RunStatus): boolean =>
  status === "completed" || status === "stopped";
