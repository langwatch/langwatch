/**
 * How a scheduled run reads, on the terminal and on the wire.
 *
 * The three run commands (`run-plan run`, `test-suite run`, `scenario run`) all end
 * in the same answer: a plan, a batch, a job count, and whatever the platform
 * refused to schedule. Printing that in one place is what keeps them from
 * drifting into three different reports of the same event.
 *
 * `emitRunResult` below is that one place. It also owns the `--wait` branch, so
 * every run command answers a machine caller with exactly ONE document,
 * whichever way the run ends.
 */

import chalk from "chalk";
import type { RunPlanRunResult } from "@/client-sdk/services/run-plans";
import { printResult, resolveOutputOptions, type RawOutputFlags } from "../../utils/output";
import { waitForBatchRun, type BatchRunOutcome } from "../../utils/waitForBatchRun";

/** How the run ended, in the final document a machine caller reads. */
export type RunCommandOutcome = "scheduled" | BatchRunOutcome;

/** Names the archived references the platform left out of the run. */
export function reportSkippedArchived(result: RunPlanRunResult): void {
  const { scenarios, targets } = result.skippedArchived;
  if (scenarios.length === 0 && targets.length === 0) return;

  console.log();
  console.log(chalk.yellow("  Skipped archived references:"));
  if (scenarios.length > 0) {
    console.log(chalk.yellow(`    Scenarios: ${scenarios.join(", ")}`));
  }
  if (targets.length > 0) {
    console.log(chalk.yellow(`    Targets: ${targets.join(", ")}`));
  }
}

/** The block printed when the caller did not ask to wait. */
export function reportScheduledRun({
  result,
  note,
}: {
  result: RunPlanRunResult;
  note?: string;
}): void {
  console.log();
  console.log(`  ${chalk.gray("Run plan:")}     ${chalk.cyan(result.planName)}`);
  console.log(`  ${chalk.gray("Batch Run ID:")} ${chalk.green(result.batchRunId)}`);
  console.log(`  ${chalk.gray("Jobs:")}         ${result.jobCount}`);
  if (note) {
    console.log(`  ${chalk.gray("Note:")}         ${note}`);
  }
  if (result.platformUrl) {
    console.log(`  ${chalk.gray("View:")}         ${chalk.underline(result.platformUrl)}`);
  }
  console.log();
  console.log(chalk.gray(`Or run it again with ${chalk.cyan("--wait")} to poll for completion.`));
}

export interface EmitRunResultParams {
  /** What the platform answered the schedule request with. */
  result: RunPlanRunResult;
  /** The note the run was filed under, for the human block. */
  note?: string;
  /** The command line, for `--wait` and for the output format. */
  options: RawOutputFlags & { wait?: boolean };
  /** What is being waited on, for the progress line: "test suite run". */
  subject: string;
}

/**
 * Says what the run did: one document under a machine format, the existing
 * blocks for a person.
 *
 * Under `--wait` the document is printed after the poll and carries the
 * outcome, the tallies and the per-run results. A timeout and a dead status
 * endpoint end on that same document, so a caller that parses stdout always
 * gets an answer rather than an empty stream.
 */
export async function emitRunResult({
  result,
  note,
  options,
  subject,
}: EmitRunResultParams): Promise<void> {
  const machine = resolveOutputOptions(options).format !== "table";

  // The skipped names are already inside the document, and prose printed before
  // it would corrupt the parser's stdout.
  if (!machine) reportSkippedArchived(result);

  // A run that scheduled nothing can never see a completion arrive. Polling
  // would run out the full timeout and report a timeout for a run that is
  // already over.
  const nothingToWaitFor = options.wait === true && result.jobCount === 0;

  if (!options.wait || nothingToWaitFor) {
    await printResult(
      { ...result, outcome: "scheduled" satisfies RunCommandOutcome },
      {
        ...options,
        table: () => {
          if (nothingToWaitFor) {
            console.log();
            console.log(chalk.yellow("  No jobs were scheduled: nothing to wait for."));
            return;
          }
          reportScheduledRun({ result, note });
        },
      },
    );
    return;
  }

  const { outcome, tallies, results } = await waitForBatchRun({
    batchRunId: result.batchRunId,
    jobCount: result.jobCount,
    subject,
    machine,
  });

  await printResult(
    { ...result, outcome, tallies, results },
    {
      ...options,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("Batch Run ID:")} ${chalk.green(result.batchRunId)}`);
        console.log();
      },
    },
  );
}
