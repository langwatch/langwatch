import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const runExperimentCommand = async (
  slug: string,
  options: { wait?: boolean },
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new ExperimentsApiService();
  const spinner = createSpinner(`Starting experiment "${slug}"...`).start();

  try {
    const runResult = await service.startRun(slug);

    spinner.succeed(
      `Experiment started! Run ID: ${chalk.cyan(runResult.runId)} (${runResult.total} cells)`,
    );

    // Without --wait, the scheduled run IS the result. The runUrl is a human
    // hint only — the port already carries it inside the machine document.
    if (!options.wait) {
      return {
        data: runResult,
        table: () => {
          if (runResult.runUrl) {
            console.log(chalk.gray(`  View at: ${runResult.runUrl}`));
          }
        },
      };
    }

    // --wait polls on the FLAG, not the format, so a format-blind handler is
    // fine: progress goes to the spinner (stderr), which the port silences in
    // machine mode, and the only stdout is the final `status` document.
    const pollSpinner = createSpinner("Waiting for completion...").start();

    let status = await service.getRunStatus(runResult.runId);
    while (status.status === "running" || status.status === "pending") {
      pollSpinner.text = `Running... ${status.progress}/${status.total} cells completed`;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      status = await service.getRunStatus(runResult.runId);
    }

    if (status.status === "failed") {
      failSpinner({
        spinner: pollSpinner,
        error: new Error(
          `Experiment failed after ${status.progress}/${status.total} cells`,
        ),
        action: "run experiment",
      });
      process.exit(1);
    }

    if (status.status === "completed") {
      pollSpinner.succeed(
        `Experiment completed! ${status.progress}/${status.total} cells`,
      );
    } else {
      pollSpinner.warn(`Experiment ${status.status}`);
    }

    return {
      data: status,
      table: () => {
        if (runResult.runUrl) {
          console.log(chalk.gray(`  View at: ${runResult.runUrl}`));
        }
        if (status.status !== "completed" || !status.summary) return;
        console.log();
        console.log(chalk.bold("  Summary:"));
        console.log(`    ${chalk.gray("Total cells:")}    ${status.summary.totalCells ?? status.total}`);
        console.log(`    ${chalk.gray("Completed:")}      ${chalk.green(String(status.summary.completedCells ?? status.progress))}`);
        if (status.summary.failedCells) {
          console.log(`    ${chalk.gray("Failed:")}         ${chalk.red(String(status.summary.failedCells))}`);
        }
        if (status.summary.duration) {
          console.log(`    ${chalk.gray("Duration:")}       ${(status.summary.duration / 1000).toFixed(1)}s`);
        }
        if (status.summary.runUrl) {
          console.log(`    ${chalk.gray("View results:")}  ${status.summary.runUrl}`);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "run experiment" });
    process.exit(1);
  }
};
