import { createLogger } from "@langwatch/observability";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import type { BatchRunDataResult } from "@langwatch/scenario-contract";

const logger = createLogger("pollForScenarioRun");

const POLLING_INTERVAL_MS = 500;
const POLLING_MAX_DURATION_MS = 30_000;
const MAX_POLLING_ATTEMPTS = Math.ceil(POLLING_MAX_DURATION_MS / POLLING_INTERVAL_MS);

interface PollForRunParams {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
}

/**
 * The server contract, not a local restatement of it.
 */
type FetchBatchRunData = (params: PollForRunParams) => Promise<BatchRunDataResult>;

export type PollResult =
  | { success: true; scenarioRunId: string }
  | {
      success: false;
      /**
       * `run_failed` — the run executed and did not pass. An outcome exists.
       * `run_error`  — the run never produced an outcome.
       * `timeout`    — no run became visible within the polling budget.
       */
      error: "timeout" | "run_error" | "run_failed";
      scenarioRunId?: string;
    };

/**
 * Classifies a terminal run status into how the caller should report it, or null when
 * the run is still going.
 */
const TERMINAL_STATUS_OUTCOME: Record<ScenarioRunStatus, "run_failed" | "run_error" | null> = {
  [ScenarioRunStatus.FAILED]: "run_failed",
  [ScenarioRunStatus.ERROR]: "run_error",
  [ScenarioRunStatus.CANCELLED]: "run_error",
  [ScenarioRunStatus.STALLED]: "run_error",
  [ScenarioRunStatus.SUCCESS]: null,
  [ScenarioRunStatus.IN_PROGRESS]: null,
  [ScenarioRunStatus.PENDING]: null,
  [ScenarioRunStatus.QUEUED]: null,
  [ScenarioRunStatus.RUNNING]: null,
};

function classifyTerminalStatus(status: ScenarioRunStatus): "run_failed" | "run_error" | null {
  // The `?? null` is not dead code. tRPC does not runtime-validate its output, so a
  // status added to the server after this client shipped arrives here unclassified, and
  // the compile-time exhaustiveness above cannot see it.
  return TERMINAL_STATUS_OUTCOME[status] ?? null;
}

/**
 * Polls for a scenario run to be available.
 */
export async function pollForScenarioRun({
  fetchBatchRunData,
  params,
}: {
  fetchBatchRunData: FetchBatchRunData;
  params: PollForRunParams;
}): Promise<PollResult> {
  logger.info(
    {
      projectId: params.projectId,
      scenarioSetId: params.scenarioSetId,
      batchRunId: params.batchRunId,
    },
    "Starting poll",
  );

  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    try {
      logger.info({ attempt }, "Fetching batch run data");
      const batchResult = await fetchBatchRunData(params);
      const runs = batchResult.changed ? batchResult.runs : [];
      logger.info({ attempt, runsCount: runs.length }, "Fetch completed");

      if (attempt % 10 === 0) {
        logger.info(
          {
            attempt,
            runsCount: runs.length,
            firstRun: runs[0]
              ? {
                  scenarioRunId: runs[0].scenarioRunId,
                  status: runs[0].status,
                  messagesCount: runs[0].messages?.length ?? 0,
                }
              : null,
          },
          "Polling attempt",
        );
      }

      if (runs.length > 0 && runs[0]?.scenarioRunId) {
        const run = runs[0];

        const terminalError = classifyTerminalStatus(run.status);
        if (terminalError) {
          logger.info(
            {
              status: run.status,
              scenarioRunId: run.scenarioRunId,
              outcome: terminalError,
            },
            "Run reached a terminal status",
          );
          return {
            success: false,
            error: terminalError,
            scenarioRunId: run.scenarioRunId,
          };
        }

        // RUN_STARTED exists - return success so frontend can show progress
        // The run page will display messages as they arrive
        logger.info(
          {
            status: run.status,
            hasMessages: run.messages && run.messages.length > 0,
            scenarioRunId: run.scenarioRunId,
          },
          "Run ready",
        );
        return { success: true, scenarioRunId: run.scenarioRunId };
      }
    } catch (error) {
      logger.error({ error }, "Fetch error");
      // Continue polling on error
    }

    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }

  logger.warn({ maxAttempts: MAX_POLLING_ATTEMPTS }, "Timed out");

  return { success: false, error: "timeout" };
}
