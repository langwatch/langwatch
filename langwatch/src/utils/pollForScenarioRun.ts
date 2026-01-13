const POLLING_INTERVAL_MS = 500;
const POLLING_MAX_DURATION_MS = 30_000;
const MAX_POLLING_ATTEMPTS = Math.ceil(
  POLLING_MAX_DURATION_MS / POLLING_INTERVAL_MS
);

interface PollForRunParams {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
}

interface ScenarioRun {
  scenarioRunId: string;
}

type FetchBatchRunData = (params: PollForRunParams) => Promise<ScenarioRun[]>;

/**
 * Polls for a scenario run to appear after execution starts.
 * Returns the scenarioRunId when found, or null if max attempts exceeded.
 */
export async function pollForScenarioRun(
  fetchBatchRunData: FetchBatchRunData,
  params: PollForRunParams
): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    try {
      const runs = await fetchBatchRunData(params);

      if (runs.length > 0 && runs[0]?.scenarioRunId) {
        return runs[0].scenarioRunId;
      }
    } catch (error) {
      console.error("Failed to fetch batch run data:", error);
      // Continue polling on error
    }

    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }

  return null;
}
