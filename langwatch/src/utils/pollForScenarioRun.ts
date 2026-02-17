import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { createLogger } from "./logger";

const logger = createLogger("pollForScenarioRun");

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
 * Polls for a scenario run to be available.
 *
 * Returns when:
 * - RUN_STARTED exists (scenarioRunId available) -> success (frontend can show progress)
 * - ERROR/FAILED/CANCELLED status -> error with scenarioRunId
 * - Timeout reached -> error without scenarioRunId
 *
 * The frontend run page handles showing progress and messages as they arrive,
 * so we don't need to wait for messages here.
 */
export async function pollForScenarioRun(
  fetchBatchRunData: FetchBatchRunData,
  params: PollForRunParams,
): Promise<PollResult> {
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
      const runs = await fetchBatchRunData(params);
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

        // Check for error/cancelled/stalled states first
        if (
          run.status === ScenarioRunStatus.ERROR ||
          run.status === ScenarioRunStatus.FAILED ||
          run.status === ScenarioRunStatus.CANCELLED ||
          run.status === ScenarioRunStatus.STALLED
        ) {
          logger.info(
            { status: run.status, scenarioRunId: run.scenarioRunId },
            "Run terminated with error, cancelled, or stalled",
          );
          return {
            success: false,
            error: "run_error",
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
