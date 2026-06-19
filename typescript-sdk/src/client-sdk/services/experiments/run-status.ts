// Experiment runs are stored as a timestamp-driven state in ClickHouse: a run
// is "completed" once finishedAt is set, "stopped" once stoppedAt is set, and
// otherwise still "running". A run that stopped emitting updates a while ago
// without ever finishing is reported as "interrupted": the SDK process likely
// died before sending finished_at/stopped_at.

import type { ExperimentRunSummary } from "./platformTypes";
import {
  ExperimentTimeoutError,
  ExperimentRunFailedError,
} from "./platformErrors";

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

export const DEFAULT_POLL_INTERVAL = 2000;
export const DEFAULT_POLL_TIMEOUT = 600000; // 10 minutes

/**
 * Status payload returned by the polling endpoint
 * (`GET /api/evaluations/v3/runs/{runId}`).
 */
export interface PollRunStatus {
  status: string;
  progress: number;
  total: number;
  summary?: ExperimentRunSummary;
  error?: string;
}

export interface PollExperimentRunResult {
  status: "completed" | "stopped";
  summary: ExperimentRunSummary;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll a run to completion.
 *
 * Calls `getStatus(runId)` every `pollInterval` ms until the run reports a
 * terminal status, mirroring the python SDK poll loop. Resolves on `completed`
 * or `stopped`, throws `ExperimentRunFailedError` on `failed`, and throws
 * `ExperimentTimeoutError` if `timeout` ms elapse first.
 *
 * The status fetcher is injected so both the experiment and workflow paths can
 * reuse the same loop.
 */
export const pollExperimentRun = async ({
  runId,
  getStatus,
  pollInterval = DEFAULT_POLL_INTERVAL,
  timeout = DEFAULT_POLL_TIMEOUT,
  onProgress,
  now = Date.now,
}: {
  runId: string;
  getStatus: (runId: string) => Promise<PollRunStatus>;
  pollInterval?: number;
  timeout?: number;
  onProgress?: (progress: number, total: number) => void;
  now?: () => number;
}): Promise<PollExperimentRunResult> => {
  const startTime = now();

  while (true) {
    if (now() - startTime > timeout) {
      const finalStatus = await getStatus(runId);
      throw new ExperimentTimeoutError(
        runId,
        finalStatus.progress,
        finalStatus.total,
      );
    }

    await sleep(pollInterval);

    const status = await getStatus(runId);
    onProgress?.(status.progress, status.total);

    if (status.status === "completed") {
      return { status: "completed", summary: status.summary ?? {} };
    }

    if (status.status === "failed") {
      throw new ExperimentRunFailedError(runId, status.error ?? "Unknown error");
    }

    if (status.status === "stopped") {
      return {
        status: "stopped",
        summary: status.summary ?? {
          runId,
          totalCells: status.total,
          completedCells: status.progress,
          failedCells: 0,
          duration: now() - startTime,
        },
      };
    }
  }
};
