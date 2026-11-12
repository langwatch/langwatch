import chalk from "chalk";

import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { parseRepeat } from "../run-plans/scopeFlags";
import { readUntilComplete } from "./results";
import { passRateText, rowPassRatesOf, type RowPassRate } from "./rowPassRates";

/** How long a waited repeated run reads its stored rows for the pass rates. */
const PASS_RATE_READ_SECONDS = 30;

export const runExperimentCommand = async (
  slug: string,
  options: {
    wait?: boolean;
    param?: string[];
    concurrency?: string;
    datasetVersion?: number;
    repeat?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const parameters = parseRunParameterFlags({ pairs: options.param });
  const concurrency = parseConcurrencyFlag({ value: options.concurrency });
  const repeat = parseRepeat(options.repeat);

  const service = new ExperimentsApiService();
  const spinner = createSpinner(`Starting experiment "${slug}"...`).start();

  try {
    const runResult = await service.startRun(slug, {
      parameters,
      ...(concurrency !== undefined ? { concurrency } : {}),
      ...(options.datasetVersion !== undefined ? { datasetVersion: options.datasetVersion } : {}),
      ...(repeat !== undefined ? { repeat } : {}),
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

    if (status.status === "completed") {
      pollSpinner.succeed(`Experiment completed! ${status.progress}/${status.total} cells`);
    } else {
      pollSpinner.warn(`Experiment ${status.status}`);
    }

    return await waitedRunResult({ service, runResult, status, slug, repeat });
  } catch (error) {
    failSpinner({ spinner, error, action: "run experiment" });
    process.exit(1);
  }
};

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

/** A waited run's answer: its status, plus each dataset row's pass rate when it repeated rows. */
async function waitedRunResult({
  service,
  runResult,
  status,
  slug,
  repeat,
}: {
  service: ExperimentsApiService;
  runResult: { runId: string; runUrl?: string };
  status: Awaited<ReturnType<ExperimentsApiService["getRunStatus"]>>;
  slug: string;
  repeat: number | undefined;
}): Promise<CommandResult> {
  const table = () => printRunStatus({ runUrl: runResult.runUrl, status });
  if (status.status !== "completed" || repeat === undefined || repeat < 2) {
    return { data: status, table };
  }
  const rowPassRates = await readRowPassRates({ service, runId: runResult.runId, slug, repeat });
  return {
    data: { ...status, rowPassRates },
    table: () => {
      table();
      printRowPassRates({ rates: rowPassRates });
    },
  };
}

/** The pass rate per dataset row and target, read once the run's rows are stored. */
async function readRowPassRates({
  service,
  runId,
  slug,
  repeat,
}: {
  service: ExperimentsApiService;
  runId: string;
  slug: string;
  repeat: number;
}): Promise<RowPassRate[]> {
  const results = await readUntilComplete({
    read: () => service.getRunResults({ runId, experimentSlug: slug }),
    waitSeconds: PASS_RATE_READ_SECONDS,
    pollMs: 2000,
    onPoll: () => {},
  });
  return rowPassRatesOf({ results, repeat });
}

function printRowPassRates({ rates }: { rates: RowPassRate[] }): void {
  const repeat = rates[0]?.repeat;
  console.log(chalk.bold(`  Pass rate per dataset row (each ran ${repeat} times):`));
  for (const rate of rates) {
    const target = rate.targetName ?? rate.targetId;
    const label = target ? `Row ${rate.row} · ${target}` : `Row ${rate.row}`;
    console.log(`    ${chalk.gray(`${label}:`)} ${passRateColour(rate)(passRateText(rate))}`);
  }
  console.log();
}

function passRateColour(rate: RowPassRate): (text: string) => string {
  if (rate.graded === 0) return chalk.gray;
  return rate.passed === rate.graded ? chalk.green : chalk.yellow;
}
