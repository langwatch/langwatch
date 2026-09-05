/**
 * How far along a batch of simulation runs is.
 */

/** What the run list gives us. Narrower than the endpoint's full response. */
export interface BatchRun {
  batchRunId?: string;
  scenarioRunId?: string;
  scenarioId?: string;
  status?: string;
  results?: { verdict?: string | null } | null;
}

export interface BatchRunProgress {
  /** Runs the batch has produced so far. */
  total: number;
  /** Runs that have stopped, whichever way they stopped. */
  completed: number;
  passed: number;
  failed: number;
}

/**
 * Statuses that mean the run is over.
 */
const FINISHED = new Set(["SUCCESS", "ERROR", "FAILED", "CANCELLED", "STALLED"]);

/**
 * A run passed when the judge said so. `SUCCESS` without a verdict counts as a
 * pass too: a scenario with no judging criteria finishes without one.
 */
const isPassed = (run: BatchRun): boolean => {
  const verdict = run.results?.verdict;
  if (verdict) return verdict === "success";
  return run.status === "SUCCESS";
};

export function tallyBatchRuns(runs: BatchRun[]): BatchRunProgress {
  const finished = runs.filter((run) => FINISHED.has(run.status ?? ""));
  const passed = finished.filter(isPassed).length;

  return {
    total: runs.length,
    completed: finished.length,
    passed,
    failed: finished.length - passed,
  };
}

/**
 * Every run in a batch, following the cursor.
 */
export async function fetchBatchRuns({
  endpoint,
  batchRunId,
  headers,
}: {
  endpoint: string;
  batchRunId: string;
  headers: Record<string, string>;
}): Promise<BatchRun[]> {
  const runs: BatchRun[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL("/api/v1/simulation-runs", endpoint);
    url.searchParams.set("batchRunId", batchRunId);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) {
      throw new Error(`status endpoint answered ${response.status}`);
    }

    const page = (await response.json()) as {
      runs?: BatchRun[];
      hasMore?: boolean;
      nextCursor?: string;
    };

    // Deployed servers apply the batchRunId filter only when scenarioSetId
    // is also present, and answer with the whole project's runs otherwise.
    // Keep only the batch's own runs, or a stale in-progress run from an
    // old batch holds the wait open until its timeout.
    runs.push(...(page.runs ?? []).filter((run) => run.batchRunId === batchRunId));
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor);

  return runs;
}
