/**
 * How a scheduled run reads, on the terminal and on the wire. `emitRunResult`
 * is the one place the three run commands report through, and it owns
 * `--wait`, so a machine caller always gets exactly ONE document.
 */

import chalk from "chalk";
import type { RunPlanRunResult } from "@/client-sdk/services/run-plans";
import { printResult, resolveOutputOptions, type RawOutputFlags } from "../../utils/output";
import { waitForBatchRun, type BatchRunOutcome } from "../../utils/waitForBatchRun";
import type { WaitOptions } from "./scopeFlags";

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
  /** The command line, for the output format. */
  options: RawOutputFlags;
  /** What `--wait` asked for; absent when the caller did not ask to wait. */
  wait?: WaitOptions;
  /** What is being waited on, for the progress line: "test suite run". */
  subject: string;
}

/**
 * Says what the run did: one document under a machine format, the existing
 * blocks for a person. Under `--wait` the document carries the outcome,
 * tallies and per-run results, even on a timeout or dead status endpoint.
 */
export async function emitRunResult({
  result,
  note,
  options,
  wait,
  subject,
}: EmitRunResultParams): Promise<void> {
  const machine = resolveOutputOptions(options).format !== "table";

  // The skipped names are already inside the document, and prose printed before
  // it would corrupt the parser's stdout.
  if (!machine) reportSkippedArchived(result);

  // A run that scheduled nothing can never see a completion arrive. Polling
  // would run out the full timeout and report a timeout for a run that is
  // already over.
  const hasNothingToWaitFor = wait !== undefined && result.jobCount === 0;

  if (!wait || hasNothingToWaitFor) {
    await printResult(
      { ...result, outcome: "scheduled" satisfies RunCommandOutcome },
      {
        ...options,
        table: () => {
          if (hasNothingToWaitFor) {
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
    timeoutMs: wait.timeoutMs,
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
