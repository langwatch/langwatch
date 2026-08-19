import { createLogger } from "@langwatch/observability";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { BatchRunDataResult } from "~/server/scenarios/scenario-event.types";

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

/**
 * The server contract, not a local restatement of it.
 *
 * `BatchRunDataResult` is derived from `runDataSchema`, so a change to the
 * wire shape lands here as a compile error instead of drifting silently. An
 * earlier hand-rolled version of this type declared `status?: string`, which
 * hid the fact that the server always sends a `ScenarioRunStatus` and forced a
 * cast in the classifier below.
 */
type FetchBatchRunData = (
  params: PollForRunParams,
) => Promise<BatchRunDataResult>;

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
 * Classifies a terminal run status into how the caller should report it, or
 * null when the run is still going.
 *
 * The distinction is the point: a run that executed and did not pass produced
 * an outcome — criteria, reasoning, a transcript — and belongs in front of the
 * user as a result. A run that errored or was cancelled produced nothing.
 * Collapsing the two tells people to go debug infrastructure that is healthy.
 *
 * STALLED is still handled for stored rows predating the stall watchdog, which
 * now terminates such runs as ERROR (see scenario-event.enums.ts).
 *
 * The table is exhaustive over `ScenarioRunStatus` with no index signature, so
 * adding a status to the enum is a compile error here until it is classified.
 * That is deliberate: an unclassified terminal status would read as "still
 * running", and the poll would burn its whole budget and report a false
 * timeout — the exact bug this module was fixed for. Mirrors the
 * exhaustive-switch rule in `scenario-run-category.ts`.
 */
const TERMINAL_STATUS_OUTCOME: Record<
  ScenarioRunStatus,
  "run_failed" | "run_error" | null
> = {
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

function classifyTerminalStatus(
  status: ScenarioRunStatus,
): "run_failed" | "run_error" | null {
  // The `?? null` is not dead: tRPC does not runtime-validate its output, so a
  // stored row carrying a status this build's enum does not know still arrives
  // here. Falling back to "still running" is the safe read.
  return TERMINAL_STATUS_OUTCOME[status] ?? null;
}

/**
 * Polls for a scenario run to be available.
 *
 * Returns when:
 * - RUN_STARTED exists (scenarioRunId available) -> success (frontend can show progress)
 * - FAILED status -> run_failed with scenarioRunId (ran, did not pass)
 * - ERROR/CANCELLED status -> run_error with scenarioRunId (could not run)
 * - Timeout reached -> error without scenarioRunId
 *
 * The frontend run page handles showing progress and messages as they arrive,
 * so we don't need to wait for messages here.
 *
 * `fetchBatchRunData` MUST bypass any client-side cache: this loop calls it
 * with an identical input on every attempt, so a cached fetcher answers every
 * attempt with whatever the first one saw and the loop can never observe the
 * run appearing. See the call site in `useRunScenario`.
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
