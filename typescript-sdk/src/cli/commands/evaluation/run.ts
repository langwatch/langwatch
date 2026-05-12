import chalk from "chalk";
import ora from "ora";
import { EvaluationsApiService } from "@/client-sdk/services/evaluations/evaluations-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const runEvaluationCommand = async (
  slug: string,
  options: { wait?: boolean; format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new EvaluationsApiService();
  const spinner = ora(`Starting evaluation "${slug}"...`).start();

  try {
    const runResult = await service.startRun(slug);

    spinner.succeed(
      `Evaluation started! Run ID: ${chalk.cyan(runResult.runId)} (${runResult.total} cells)`,
    );

    if (runResult.runUrl) {
      console.log(chalk.gray(`  View at: ${runResult.runUrl}`));
    }

    // If --wait flag is set, poll until completion
    if (options.wait) {
      const pollSpinner = ora("Waiting for completion...").start();

      let status = await service.getRunStatus(runResult.runId);
      while (status.status === "running" || status.status === "pending") {
        pollSpinner.text = `Running... ${status.progress}/${status.total} cells completed`;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        status = await service.getRunStatus(runResult.runId);
      }

      if (status.status === "completed") {
        pollSpinner.succeed(
          `Evaluation completed! ${status.progress}/${status.total} cells`,
        );

        if (options.format === "json") {
          console.log(JSON.stringify(status, null, 2));
        } else if (status.summary) {
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
        }
      } else if (status.status === "failed") {
        pollSpinner.fail(
          `Evaluation failed after ${status.progress}/${status.total} cells`,
        );
        process.exit(1);
      } else {
        pollSpinner.warn(`Evaluation ${status.status}`);
      }
    } else if (options.format === "json") {
      console.log(JSON.stringify(runResult, null, 2));
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "run evaluation" });
    process.exit(1);
  }
};
