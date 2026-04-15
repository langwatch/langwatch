import chalk from "chalk";
import ora from "ora";
import {
  EvaluationsApiService,
  EvaluationsApiError,
} from "@/client-sdk/services/evaluations/evaluations-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const evaluationStatusCommand = async (
  runId: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new EvaluationsApiService();
  const spinner = ora(`Checking run status "${runId}"...`).start();

  try {
    const status = await service.getRunStatus(runId);

    const statusColor =
      status.status === "completed"
        ? chalk.green
        : status.status === "failed"
          ? chalk.red
          : status.status === "running"
            ? chalk.yellow
            : chalk.gray;

    spinner.succeed(`Run ${chalk.cyan(runId)}: ${statusColor(status.status)}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("Status:")}   ${statusColor(status.status)}`);
    console.log(`  ${chalk.gray("Progress:")} ${status.progress}/${status.total} cells`);

    if (status.startedAt) {
      console.log(`  ${chalk.gray("Started:")}  ${new Date(status.startedAt).toLocaleString()}`);
    }
    if (status.finishedAt) {
      console.log(`  ${chalk.gray("Finished:")} ${new Date(status.finishedAt).toLocaleString()}`);
    }

    if (status.summary) {
      console.log();
      console.log(chalk.bold("  Summary:"));
      if (status.summary.completedCells !== undefined) {
        console.log(`    ${chalk.gray("Completed:")} ${chalk.green(String(status.summary.completedCells))}`);
      }
      if (status.summary.failedCells) {
        console.log(`    ${chalk.gray("Failed:")}    ${chalk.red(String(status.summary.failedCells))}`);
      }
      if (status.summary.duration) {
        console.log(`    ${chalk.gray("Duration:")}  ${(status.summary.duration / 1000).toFixed(1)}s`);
      }
      if (status.summary.runUrl) {
        console.log(`    ${chalk.gray("View:")}      ${status.summary.runUrl}`);
      }
    }

    console.log();
  } catch (error) {
    spinner.fail();
    if (error instanceof EvaluationsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error checking status: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
