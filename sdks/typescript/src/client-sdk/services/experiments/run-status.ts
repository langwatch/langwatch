// Experiment runs are stored as a timestamp-driven state in ClickHouse: a run
// is "completed" once finishedAt is set, "stopped" once stoppedAt is set, and
// otherwise still "running". A run that stopped emitting updates a while ago
// without ever finishing is reported as "interrupted": the SDK process likely
// died before sending finished_at/stopped_at.

import { ExperimentTimeoutError, ExperimentRunFailedError } from "./platformErrors";
import type { ExperimentRunSummary } from "./platformTypes";

export const INTERRUPTED_THRESHOLD_MS = 5 * 60 * 1000;

export type RunStatus = "completed" | "stopped" | "running" | "interrupted";

export interface RunTimestamps {
  createdAt?: number | null;
  updatedAt?: number | null;
  finishedAt?: number | null;
  stoppedAt?: number | null;
}

export const deriveRunStatus = (timestamps: RunTimestamps, now: number = Date.now()): RunStatus => {
  if (timestamps.stoppedAt != null) return "stopped";
  if (timestamps.finishedAt != null) return "completed";
  if (timestamps.updatedAt != null && now - timestamps.updatedAt > INTERRUPTED_THRESHOLD_MS) {
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls a run to completion via `getStatus`, mirroring the python SDK.
 * Resolves on `completed`/`stopped`, throws on `failed` or timeout. The
 * fetcher is injected so experiment and workflow paths share this one loop.
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
      throw new ExperimentTimeoutError(runId, finalStatus.progress, finalStatus.total);
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

/**
 * Replaces a URL's domain with a new base, preserving path/query/fragment.
 * The platform returns its own cloud URL for a run; rebasing it keeps a
 * self-hosted run pointing local instead of app.langwatch.ai.
 */
export const rebaseUrlToEndpoint = (url: string, newBase: string): string => {
  if (!url) return url;
  try {
    const parsedUrl = new URL(url);
    const parsedNewBase = new URL(newBase);
    return `${parsedNewBase.origin}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return url;
  }
};

/**
 * Fetches a run's per-row results, retrying through the brief window where
 * ClickHouse projection lags (404 or empty). Retries up to `maxAttempts`
 * only when the run reported rows; otherwise the first read is returned.
 */
export const fetchResultsWithRetry = async <T>({
  getResults,
  isEmpty,
  expectsRows,
  delay = DEFAULT_POLL_INTERVAL,
  maxAttempts = 6,
}: {
  getResults: () => Promise<T>;
  isEmpty: (results: T) => boolean;
  expectsRows: boolean;
  delay?: number;
  maxAttempts?: number;
}): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const results = await getResults();
      if (expectsRows && isEmpty(results) && attempt < maxAttempts) {
        await sleep(delay);
        continue;
      }
      return results;
    } catch (error) {
      lastError = error;
      // Only the rows-expected path waits out the post-completion projection
      // lag (a 404 / "not yet available" right after the run finishes). With no
      // rows expected a thrown error is terminal, so surface it immediately
      // instead of delaying through every attempt.
      if (expectsRows && attempt < maxAttempts) {
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};
