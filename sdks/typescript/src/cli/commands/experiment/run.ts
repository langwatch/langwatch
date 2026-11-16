import chalk from "chalk";

import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import type { ExperimentRunSummary } from "@/client-sdk/services/experiments/platformTypes";
import {
  evaluatorFailuresOf,
  evaluatorTalliesMissing,
  MISSING_TALLIES_MESSAGE,
} from "@/client-sdk/services/experiments/run-gate";

import { resolveCredentials } from "../../utils/apiKey";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

export const runExperimentCommand = async (
  slug: string,
  options: {
    wait?: boolean;
    param?: string[];
    concurrency?: string;
    datasetVersion?: number;
    failOnEvaluatorFailures?: boolean;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  if (options.failOnEvaluatorFailures && !options.wait) {
    reportCommandError({
      error: commandValidationError(
        "--fail-on-evaluator-failures needs --wait: only a waited run has results to gate on",
      ),
    });
    process.exit(1);
  }

  const parameters = parseRunParameterFlags({ pairs: options.param });
  const concurrency = parseConcurrencyFlag({ value: options.concurrency });

  const service = new ExperimentsApiService();
  const spinner = createSpinner(`Starting experiment "${slug}"...`).start();

  try {
    const runResult = await service.startRun(slug, {
      parameters,
      ...(concurrency !== undefined ? { concurrency } : {}),
      ...(options.datasetVersion !== undefined ? { datasetVersion: options.datasetVersion } : {}),
    });

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
        error: new Error(`Experiment failed after ${status.progress}/${status.total} cells`),
        action: "run experiment",
      });
      process.exit(1);
    }

    reportFinishedRun({
      spinner: pollSpinner,
      status,
      failOnEvaluatorFailures: options.failOnEvaluatorFailures,
    });

    return {
      data: status,
      table: () => printRunStatus({ runUrl: runResult.runUrl, status }),
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "run experiment" });
    process.exit(1);
  }
};

/** Prints how a finished run ended; an opt-in gate fails the job on any failure. */
function reportFinishedRun({
  spinner,
  status,
  failOnEvaluatorFailures,
}: {
  spinner: ReturnType<typeof createSpinner>;
  status: Awaited<ReturnType<ExperimentsApiService["getRunStatus"]>>;
  failOnEvaluatorFailures: boolean | undefined;
}): void {
  if (status.status !== "completed") {
    spinner.warn(`Experiment ${status.status}`);
    return;
  }
  if (failOnEvaluatorFailures && evaluatorTalliesMissing(status.summary)) {
    spinner.warn(`Experiment completed. ${MISSING_TALLIES_MESSAGE}`);
    process.exitCode = 1;
    return;
  }
  const failures = countRunFailures(status.summary);
  if (!failures.any) {
    spinner.succeed(`Experiment completed! ${status.progress}/${status.total} cells`);
    return;
  }
  spinner.warn(
    `Experiment completed with failures: ${failures.evaluations} failed evaluation(s), ` +
      `${failures.evaluatorErrors} evaluator error(s), ${failures.cells} errored cell(s)`,
  );
  // Opt-in, like `scenario run --wait`: the document still prints, then the job fails.
  if (failOnEvaluatorFailures) process.exitCode = 1;
}

/**
 * What a completed run failed on: evaluations that returned a failing verdict,
 * evaluators that crashed instead of judging, and cells that errored. Any of them,
 * or a summary with no evaluator results, fails a `--wait --fail-on-evaluator-failures` run.
 */
export function countRunFailures(summary: ExperimentRunSummary | undefined): {
  evaluations: number;
  evaluatorErrors: number;
  cells: number;
  any: boolean;
} {
  const { failed: evaluations, errored: evaluatorErrors } = evaluatorFailuresOf(summary);
  const cells = summary?.failedCells ?? 0;
  return {
    evaluations,
    evaluatorErrors,
    cells,
    any: evaluations > 0 || evaluatorErrors > 0 || cells > 0,
  };
}

function parseConcurrencyFlag({ value }: { value: string | undefined }): number | undefined {
  if (value === undefined) return undefined;
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 24) {
    reportCommandError({
      error: commandValidationError(
        `Invalid --concurrency value: ${value} (expected a whole number from 1 to 24)`,
      ),
    });
    process.exit(1);
  }
  return concurrency;
}

function printRunStatus({
  runUrl,
  status,
}: {
  runUrl: string | undefined;
  status: Awaited<ReturnType<ExperimentsApiService["getRunStatus"]>>;
}): void {
  if (runUrl) {
    console.log(chalk.gray(`  View at: ${runUrl}`));
  }
  if (status.status !== "completed" || !status.summary) return;
  console.log();
  console.log(chalk.bold("  Summary:"));
  console.log(`    ${chalk.gray("Total cells:")}    ${status.summary.totalCells ?? status.total}`);
  console.log(
    `    ${chalk.gray("Completed:")}      ${chalk.green(String(status.summary.completedCells ?? status.progress))}`,
  );
  if (status.summary.failedCells) {
    console.log(
      `    ${chalk.gray("Failed:")}         ${chalk.red(String(status.summary.failedCells))}`,
    );
  }
  for (const evaluator of status.summary.evaluators ?? []) {
    const failed = evaluator.failed > 0 ? chalk.red(`${evaluator.failed} failed`) : "0 failed";
    const errored = evaluator.errored ? `, ${chalk.red(`${evaluator.errored} errored`)}` : "";
    // A pass rate over no verdicts would read as "all failed"; say what happened instead.
    const rate =
      evaluator.passed + evaluator.failed > 0 ? `${evaluator.passRate.toFixed(1)}%` : "no verdicts";
    console.log(
      `    ${chalk.gray(`${evaluator.name}:`)} ${evaluator.passed} passed, ${failed}` +
        `${errored} (${rate})`,
    );
  }
  if (status.summary.duration) {
    console.log(
      `    ${chalk.gray("Duration:")}       ${(status.summary.duration / 1000).toFixed(1)}s`,
    );
  }
  if (status.summary.runUrl) {
    console.log(`    ${chalk.gray("View results:")}  ${status.summary.runUrl}`);
  }
  console.log();
}
