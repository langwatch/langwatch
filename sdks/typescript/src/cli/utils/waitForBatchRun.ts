/**
 * The `--wait` poll every run command shares.
 *
 * A run command schedules a batch and answers immediately. `--wait` turns that
 * into a verdict: it polls the run list until every run of the batch has
 * stopped, then reports the pass and fail counts and sets a failing exit code
 * when any run failed. Three commands need exactly that answer, and a batch
 * that reads as done in one and still running in another is worse than either.
 *
 * @see specs/features/run-plan-cli.feature
 */

import chalk from "chalk";
import { scopedApiKey } from "@/internal/credentialContext";
import { buildAuthHeaders } from "@/internal/api/auth";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { fetchBatchRuns, tallyBatchRuns } from "./batchRunProgress";
import { createSpinner } from "./spinner";
import { failSpinner } from "./spinnerError";
import { resolveOutputFormat } from "./errorOutput";

/** How long the poll waits before giving up. */
const TIMEOUT_MS = 10 * 60 * 1000;

/** How long the poll sleeps between reads. */
const POLL_INTERVAL_MS = 3000;

/**
 * How many reads in a row may fail before the wait ends.
 *
 * A status endpoint that is down used to be indistinguishable from a batch
 * that is merely slow: every poll error was swallowed and the wait ran the
 * full timeout before reporting one.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

export interface WaitForBatchRunParams {
  /** The batch to follow. */
  batchRunId: string;
  /** How many jobs the schedule reported, so a partial first page reads right. */
  jobCount: number;
  /** What the command is doing, for the failure line: "run suite", "run scenario". */
  action: string;
  /** What is being waited on, for the progress line: "suite run", "scenario run". */
  subject: string;
}

/**
 * Polls until the batch is over.
 *
 * Sets `process.exitCode = 1` when a run of the batch failed: `--wait` exists
 * to report the verdict, and exiting 0 on a red batch hides it from every
 * machine caller.
 */
export async function waitForBatchRun({
  batchRunId,
  jobCount,
  action,
  subject,
}: WaitForBatchRunParams): Promise<void> {
  // Nothing was scheduled, so no completion can ever arrive. Polling would run
  // out the full timeout and report a timeout for a run that is already over.
  if (jobCount === 0) {
    console.log();
    console.log(
      chalk.yellow("  No jobs were scheduled — nothing to wait for."),
    );
    return;
  }

  console.log();
  const pollSpinner = createSpinner(
    `Waiting for the ${subject} to complete...`,
  ).start();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  let completed = false;
  let lastStatus = "";
  let consecutivePollFailures = 0;
  const startTime = Date.now();

  while (!completed) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      failSpinner({
        spinner: pollSpinner,
        error: new Error(
          `The ${subject} timed out after ${TIMEOUT_MS / 60000} minutes`,
        ),
        action,
      });
      // Follow-up prose is human-only — in a machine format the structured
      // document above must keep stdout to itself.
      if (resolveOutputFormat() === "text") {
        console.log(
          chalk.yellow(
            `Check results in the dashboard. Batch ID: ${batchRunId}`,
          ),
        );
      }
      process.exit(1);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const progress = tallyBatchRuns(
        await fetchBatchRuns({
          endpoint,
          batchRunId,
          headers: buildAuthHeaders({ apiKey }),
        }),
      );

      // The schedule knows how many jobs it dispatched; the endpoint only knows
      // how many runs exist so far. Take whichever is larger, or a batch whose
      // runs have not all been created yet reads as finished on the first poll.
      const total = Math.max(progress.total, jobCount);
      const { completed: completedCount, passed, failed } = progress;

      const newStatus = `${completedCount}/${total} completed (${passed} passed, ${failed} failed)`;
      if (newStatus !== lastStatus) {
        pollSpinner.text = `Running... ${newStatus}`;
        lastStatus = newStatus;
      }

      if (completedCount >= total && total > 0) {
        completed = true;
        if (failed > 0) {
          pollSpinner.warn(
            `The ${subject} completed: ${passed}/${total} passed, ${chalk.red(`${failed} failed`)}`,
          );
          process.exitCode = 1;
        } else {
          pollSpinner.succeed(
            `The ${subject} completed: ${chalk.green(`${passed}/${total} passed`)}`,
          );
        }
      }
    } catch {
      consecutivePollFailures++;
      if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        pollSpinner.warn(
          `Stopped waiting: the run status endpoint failed ${consecutivePollFailures} times in a row. ` +
            `The ${subject} is still going — check batch ${batchRunId}.`,
        );
        process.exitCode = 1;
        break;
      }
      continue;
    }
    consecutivePollFailures = 0;
  }

  console.log();
  console.log(`  ${chalk.gray("Batch Run ID:")} ${chalk.green(batchRunId)}`);
  console.log();
}
