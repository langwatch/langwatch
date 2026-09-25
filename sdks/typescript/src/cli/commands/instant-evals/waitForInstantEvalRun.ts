/**
 * The `--wait` poll for a run, modelled on `utils/waitForBatchRun.ts`: progress on the spinner
 * (stderr), the verdict returned, failure sets the exit code. Progress is rows judged and matched.
 * @see specs/features/instant-eval-cli.feature
 */

import chalk from "chalk";

import type { InstantEvalRun, InstantEvalsApiService } from "@/client-sdk/services/instant-evals";

import { createSpinner } from "../../utils/spinner";

/** How long the poll sleeps between reads. */
const POLL_INTERVAL_MS = 3_000;

/** How many reads in a row may fail before the wait gives up. */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

/** How long `--wait` runs when it is given no number of minutes. */
export const DEFAULT_INSTANT_EVAL_WAIT_MINUTES = 45;

/** How the wait ended. */
export type InstantEvalWaitOutcome =
  | "finished"
  | "failed"
  | "cancelled"
  | "timeout"
  | "poll_failure";

/** What the wait answers with, whichever way it ended. */
export interface InstantEvalWaitResult {
  outcome: InstantEvalWaitOutcome;
  /** The run as the last successful poll read it. */
  run: InstantEvalRun;
}

/** `--wait` with no value means the default; `--wait 5` means five minutes. */
export function readWaitMinutes(raw: boolean | string | undefined): number | undefined {
  if (raw === undefined || raw === false) return undefined;
  if (raw === true) return DEFAULT_INSTANT_EVAL_WAIT_MINUTES;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_INSTANT_EVAL_WAIT_MINUTES;
}

/** Whether a run has stopped moving. */
const isOver = (status: InstantEvalRun["status"]): boolean =>
  status === "finished" || status === "failed" || status === "cancelled";

/** "3,200", the way a progress line reads it. */
const grouped = (value: number): string => value.toLocaleString("en-US");

/** `Judging... 3,200/10,000 (412 matched)`. */
export function instantEvalProgressLine(run: InstantEvalRun): string {
  const total = run.total ?? run.limit;
  const matched = run.matched === null ? "" : ` (${grouped(run.matched)} matched)`;
  return `Judging... ${grouped(run.progress)}/${grouped(total)}${matched}`;
}

export async function waitForInstantEvalRun({
  service,
  runId,
  machine,
  timeoutMs,
  known,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  service: Pick<InstantEvalsApiService, "get">;
  runId: string;
  /** The caller asked for a machine format, so stdout is the final document's. */
  machine: boolean;
  timeoutMs: number;
  /**
   * The run as the caller already read it, returned when giving up before any
   * poll succeeded. Both exits here are reached because reading the run is
   * failing, so a last read cannot be relied on to answer.
   */
  known: InstantEvalRun;
  /** Injected so a test does not sit through the poll interval. */
  sleep?: (ms: number) => Promise<void>;
}): Promise<InstantEvalWaitResult> {
  if (!machine) console.log();
  const spinner = createSpinner("Waiting for the run to finish...").start();

  const startedAt = Date.now();
  let failures = 0;
  let last: InstantEvalRun | undefined;
  let lastLine = "";

  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      reportTimedOut({ spinner, timeoutMs, machine, runId });
      return {
        outcome: "timeout",
        run: last ?? (await lastResort(service, runId, known)),
      };
    }

    await sleep(POLL_INTERVAL_MS);

    let run: InstantEvalRun;
    try {
      run = await service.get(runId);
    } catch {
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        process.exitCode = 1;
        spinner.warn(
          `Stopped waiting: reading the run failed ${failures} times in a row. It is still going. Check ${runId}.`,
        );
        return {
          outcome: "poll_failure",
          run: last ?? (await lastResort(service, runId, known)),
        };
      }
      continue;
    }
    failures = 0;
    last = run;

    const line = instantEvalProgressLine(run);
    if (line !== lastLine) {
      spinner.text = line;
      lastLine = line;
    }

    if (!isOver(run.status)) continue;

    return reportOverRun({ run, spinner });
  }
}

/**
 * The run, read once more for the document a machine caller reads. Only reached when the wait ended
 * before any poll succeeded, and a failure here is the caller's own: they asked to wait on a run
 * the platform will not answer for.
 */
async function lastResort(
  service: Pick<InstantEvalsApiService, "get">,
  runId: string,
  known: InstantEvalRun,
): Promise<InstantEvalRun> {
  try {
    return await service.get(runId);
  } catch {
    return known;
  }
}

type WaitSpinner = ReturnType<typeof createSpinner>;

function reportTimedOut({
  spinner,
  timeoutMs,
  machine,
  runId,
}: {
  spinner: WaitSpinner;
  timeoutMs: number;
  machine: boolean;
  runId: string;
}): void {
  process.exitCode = 1;
  const minutes = timeoutMs / 60_000;
  spinner.fail(
    chalk.red(
      `Stopped waiting after ${minutes} minute${minutes === 1 ? "" : "s"}. The run is still going.`,
    ),
  );
  if (!machine) {
    console.log(chalk.yellow(`Follow it with: langwatch instant-eval status ${runId}`));
  }
}

/** The result for a run that is over, reported on the spinner by how it ended. */
function reportOverRun({
  run,
  spinner,
}: {
  run: InstantEvalRun;
  spinner: WaitSpinner;
}): InstantEvalWaitResult {
  if (run.status === "finished") {
    spinner.succeed(
      `Judged ${grouped(run.progress)} row${run.progress === 1 ? "" : "s"}` +
        (run.matched === null ? "" : `, ${chalk.green(`${grouped(run.matched)} matched`)}`),
    );
    return { outcome: "finished", run };
  }
  if (run.status === "cancelled") {
    spinner.warn(`The run was cancelled after judging ${grouped(run.progress)} rows.`);
    return { outcome: "cancelled", run };
  }
  process.exitCode = 1;
  spinner.fail(chalk.red(`The run failed: ${run.error ?? "unknown"}`));
  return { outcome: "failed", run };
}
