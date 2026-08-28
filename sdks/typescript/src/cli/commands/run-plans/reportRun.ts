/**
 * How a scheduled run reads on the terminal.
 *
 * The three run commands (`run-plan run`, `suite run`, `scenario run`) all end
 * in the same answer: a plan, a batch, a job count, and whatever the platform
 * refused to schedule. Printing that in one place is what keeps them from
 * drifting into three different reports of the same event.
 */

import chalk from "chalk";
import type { RunPlanRunResult } from "@/client-sdk/services/run-plans";

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
  console.log(
    chalk.gray(`Or run it again with ${chalk.cyan("--wait")} to poll for completion.`),
  );
}
