/**
 * The `--wait` poll every run command shares: turns a scheduled batch into
 * a verdict, reporting pass/fail counts and a failing exit code. RETURNS
 * the verdict rather than printing it.
 */

import chalk from "chalk";
import { scopedApiKey } from "@/internal/credentialContext";
import { buildAuthHeaders } from "@/internal/api/auth";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { fetchBatchRuns, tallyBatchRuns, type BatchRun } from "./batchRunProgress";
import { createSpinner } from "./spinner";

/** How long the poll sleeps between reads. */
const POLL_INTERVAL_MS = 3000;

/**
 * How many reads in a row may fail before the wait ends, so a down status
 * endpoint is distinguishable from a batch that is merely slow.
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
  /** How long the poll runs before it gives up, from `--wait [minutes]`. */
  timeoutMs: number;
}

/** "45 minutes", "1 minute", "0.5 minutes": the limit as the failure line says it. */
const describeMinutes = (timeoutMs: number): string => {
  const minutes = timeoutMs / 60000;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
};

/** The per-run rows of the final document, from the last successful poll. */
const toRunResults = (runs: BatchRun[]): BatchRunResultRow[] =>
  runs.map((run) => ({
    scenarioRunId: run.scenarioRunId ?? null,
    scenarioId: run.scenarioId ?? null,
    status: run.status ?? null,
    verdict: run.results?.verdict ?? null,
  }));

/**
 * Polls until the batch is over. Sets `process.exitCode = 1` on a failed
 * run, a timeout, or a status endpoint that stays down. RETURNS on timeout
 * rather than ending the process, so the command can still print its document.
 */
export async function waitForBatchRun({
  batchRunId,
  jobCount,
  subject,
  machine,
  timeoutMs,
}: WaitForBatchRunParams): Promise<WaitForBatchRunResult> {
  if (!machine) console.log();
  const pollSpinner = createSpinner(`Waiting for the ${subject} to complete...`).start();

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
    if (Date.now() - startTime > timeoutMs) {
      outcome = "timeout";
      process.exitCode = 1;
      pollSpinner.fail(chalk.red(`The ${subject} timed out after ${describeMinutes(timeoutMs)}`));
      if (!machine) {
        console.log(chalk.yellow(`Check results in the dashboard. Batch ID: ${batchRunId}`));
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
