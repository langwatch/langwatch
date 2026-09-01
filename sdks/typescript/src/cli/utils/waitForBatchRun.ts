/**
 * The `--wait` poll every run command shares.
 *
 * A run command schedules a batch and answers immediately. `--wait` turns that
 * into a verdict: it polls the run list until every run of the batch has
 * stopped, then reports the pass and fail counts and sets a failing exit code
 * when any run failed. Three commands need exactly that answer, and a batch
 * that reads as done in one and still running in another is worse than either.
 *
 * The poll RETURNS the verdict instead of printing it. The progress prose is
 * for a person and stays on the spinner (stderr); the command puts the same
 * numbers into the single final document a machine caller reads.
 *
 * @see specs/features/run-plan-cli.feature
 */

import chalk from "chalk";
import { scopedApiKey } from "@/internal/credentialContext";
import { buildAuthHeaders } from "@/internal/api/auth";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import {
  fetchBatchRuns,
  tallyBatchRuns,
  type BatchRun,
} from "./batchRunProgress";
import { createSpinner } from "./spinner";

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

/** How the wait ended. */
export type BatchRunOutcome = "passed" | "failed" | "timeout" | "poll_failure";

/** The counts the wait reached, from the last successful poll. */
export interface BatchRunTallies {
  total: number;
  completed: number;
  passed: number;
  failed: number;
}

/** One run of the batch, as the final document carries it. */
export interface BatchRunResultRow {
  scenarioRunId: string | null;
  scenarioId: string | null;
  status: string | null;
  verdict: string | null;
}

/** What the wait answers with, whichever way it ended. */
export interface WaitForBatchRunResult {
  outcome: BatchRunOutcome;
  tallies: BatchRunTallies;
  results: BatchRunResultRow[];
}

export interface WaitForBatchRunParams {
  /** The batch to follow. */
  batchRunId: string;
  /** How many jobs the schedule reported, so a partial first page reads right. */
  jobCount: number;
  /** What is being waited on, for the progress line: "test suite run", "scenario run". */
  subject: string;
  /**
   * The caller asked for a machine format, so stdout belongs to the command's
   * final document. Follow-up prose is left out.
   */
  machine: boolean;
}

/** The per-run rows of the final document, from the last successful poll. */
const toRunResults = (runs: BatchRun[]): BatchRunResultRow[] =>
  runs.map((run) => ({
    scenarioRunId: run.scenarioRunId ?? null,
    scenarioId: run.scenarioId ?? null,
    status: run.status ?? null,
    verdict: run.results?.verdict ?? null,
  }));

/**
 * Polls until the batch is over.
 *
 * Sets `process.exitCode = 1` when a run of the batch failed, when the wait
 * times out, and when the status endpoint stays down: `--wait` exists to report
 * the verdict, and exiting 0 on a red batch hides it from every machine caller.
 * A timeout sets the exit code and RETURNS rather than ending the process, so
 * the command can still print its final document.
 */
export async function waitForBatchRun({
  batchRunId,
  jobCount,
  subject,
  machine,
}: WaitForBatchRunParams): Promise<WaitForBatchRunResult> {
  if (!machine) console.log();
  const pollSpinner = createSpinner(
    `Waiting for the ${subject} to complete...`,
  ).start();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  let completed = false;
  let lastStatus = "";
  let consecutivePollFailures = 0;
  const startTime = Date.now();

  // Every exit path of the loop lands on the one answer below, so the outcome
  // and the counts live outside it.
  let outcome: BatchRunOutcome = "poll_failure";
  let tallies: BatchRunTallies = {
    total: jobCount,
    completed: 0,
    passed: 0,
    failed: 0,
  };
  let latestRuns: BatchRun[] = [];

  while (!completed) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      outcome = "timeout";
      process.exitCode = 1;
      pollSpinner.fail(
        chalk.red(
          `The ${subject} timed out after ${TIMEOUT_MS / 60000} minutes`,
        ),
      );
      if (!machine) {
        console.log(
          chalk.yellow(
            `Check results in the dashboard. Batch ID: ${batchRunId}`,
          ),
        );
      }
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      latestRuns = await fetchBatchRuns({
        endpoint,
        batchRunId,
        headers: buildAuthHeaders({ apiKey }),
      });
      const progress = tallyBatchRuns(latestRuns);

      // The schedule knows how many jobs it dispatched; the endpoint only knows
      // how many runs exist so far. Take whichever is larger, or a batch whose
      // runs have not all been created yet reads as finished on the first poll.
      const total = Math.max(progress.total, jobCount);
      tallies = {
        total,
        completed: progress.completed,
        passed: progress.passed,
        failed: progress.failed,
      };

      const newStatus = `${tallies.completed}/${total} completed (${tallies.passed} passed, ${tallies.failed} failed)`;
      if (newStatus !== lastStatus) {
        pollSpinner.text = `Running... ${newStatus}`;
        lastStatus = newStatus;
      }

      if (tallies.completed >= total && total > 0) {
        completed = true;
        if (tallies.failed > 0) {
          outcome = "failed";
          pollSpinner.warn(
            `The ${subject} completed: ${tallies.passed}/${total} passed, ${chalk.red(`${tallies.failed} failed`)}`,
          );
          process.exitCode = 1;
        } else {
          outcome = "passed";
          pollSpinner.succeed(
            `The ${subject} completed: ${chalk.green(`${tallies.passed}/${total} passed`)}`,
          );
        }
      }
    } catch {
      consecutivePollFailures++;
      if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        outcome = "poll_failure";
        pollSpinner.warn(
          `Stopped waiting: the run status endpoint failed ${consecutivePollFailures} times in a row. ` +
            `The ${subject} is still going. Check batch ${batchRunId}.`,
        );
        process.exitCode = 1;
        break;
      }
      continue;
    }
    consecutivePollFailures = 0;
  }

  return { outcome, tallies, results: toRunResults(latestRuns) };
}
