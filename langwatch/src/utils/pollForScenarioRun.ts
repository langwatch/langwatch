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
  messages?: unknown[];
}

type FetchBatchRunData = (params: PollForRunParams) => Promise<ScenarioRun[]>;

export type PollResult =
  | { success: true; scenarioRunId: string }
  | { success: false; error: "timeout" | "run_error"; scenarioRunId?: string };

/**
 * Polls for a scenario run to have content or reach terminal state.
 * Returns when: has messages (something to show), or ERROR/FAILED/SUCCESS.
 * Returns success with scenarioRunId, or error with reason.
 */
export async function pollForScenarioRun(
  fetchBatchRunData: FetchBatchRunData,
  params: PollForRunParams,
): Promise<PollResult> {
  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    try {
      const runs = await fetchBatchRunData(params);

      if (attempt % 10 === 0) {
        console.log("[pollForScenarioRun] Polling attempt", attempt, {
          runsCount: runs.length,
          firstRun: runs[0]
            ? {
                scenarioRunId: runs[0].scenarioRunId,
                status: runs[0].status,
                messagesCount: runs[0].messages?.length ?? 0,
              }
            : null,
        });
      }

      if (runs.length > 0 && runs[0]?.scenarioRunId) {
        const run = runs[0];

        // Check for error states first
        if (run.status === "ERROR" || run.status === "FAILED") {
          console.log("[pollForScenarioRun] Run errored", run.status);
          return {
            success: false,
            error: "run_error",
            scenarioRunId: run.scenarioRunId,
          };
        }

        // Return success if we have messages to show or run is complete
        const hasMessages = run.messages && run.messages.length > 0;
        if (hasMessages || run.status === "SUCCESS") {
          console.log("[pollForScenarioRun] Run ready", {
            status: run.status,
            hasMessages,
          });
          return { success: true, scenarioRunId: run.scenarioRunId };
        }

        // Run exists but no messages yet and not terminal - keep polling
      }
    } catch (error) {
      console.error("[pollForScenarioRun] Fetch error:", error);
      // Continue polling on error
    }

    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }

  console.log("[pollForScenarioRun] Timed out after", MAX_POLLING_ATTEMPTS, "attempts");

  return { success: false, error: "timeout" };
}
