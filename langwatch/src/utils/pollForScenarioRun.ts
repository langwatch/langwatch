const POLLING_INTERVAL_MS = 500;
const POLLING_MAX_DURATION_MS = 30_000;
const MAX_POLLING_ATTEMPTS = Math.ceil(
  POLLING_MAX_DURATION_MS / POLLING_INTERVAL_MS,
);

interface PollForRunParams {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
}

interface ScenarioRun {
  scenarioRunId: string;
  status?: string;
}

type FetchBatchRunData = (params: PollForRunParams) => Promise<ScenarioRun[]>;

export type PollResult =
  | { success: true; scenarioRunId: string }
  | { success: false; error: "timeout" | "run_error"; scenarioRunId?: string };

/**
 * Polls for a scenario run to appear after execution starts.
 * Returns success with scenarioRunId, or error with reason.
 */
export async function pollForScenarioRun(
  fetchBatchRunData: FetchBatchRunData,
  params: PollForRunParams,
): Promise<PollResult> {
  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    try {
      const runs = await fetchBatchRunData(params);

      if (runs.length > 0 && runs[0]?.scenarioRunId) {
        const run = runs[0];
        // Check if run has errored
        if (run.status === "ERROR" || run.status === "FAILED") {
          return {
            success: false,
            error: "run_error",
            scenarioRunId: run.scenarioRunId,
          };
        }
        // Run found and not errored
        return { success: true, scenarioRunId: run.scenarioRunId };
      }
    } catch (error) {
      console.error("Failed to fetch batch run data:", error);
      // Continue polling on error
    }

    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }

  return { success: false, error: "timeout" };
}
