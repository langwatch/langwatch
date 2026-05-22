import chalk from "chalk";
import ora from "ora";
import {
  ExperimentsApiService,
  type ExperimentSummary,
} from "@/client-sdk/services/experiments/experiments-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { formatTable, formatRelativeTime } from "../../utils/formatting";

export interface ExperimentListOptions {
  format?: string;
  limit?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_PAGE_SIZE = 200;

export const experimentListCommand = async (
  options: ExperimentListOptions = {},
): Promise<void> => {
  checkApiKey();

  const format = options.format === "json" ? "json" : "table";
  const limit = (() => {
    const parsed = options.limit ? parseInt(options.limit, 10) : DEFAULT_LIMIT;
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_PAGE_SIZE);
  })();

  const service = new ExperimentsApiService();
  const spinner = ora("Fetching experiments...").start();

  try {
    const result = await service.listExperiments({ pageSize: limit });
    spinner.succeed(
      `Found ${result.pagination.totalHits} experiment${result.pagination.totalHits === 1 ? "" : "s"}`,
    );

    if (format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.experiments.length === 0) {
      console.log();
      console.log(chalk.gray("No experiments found in this project."));
      return;
    }

    console.log();

    const tableData = result.experiments.map((exp: ExperimentSummary) => ({
      Name: exp.name ?? exp.slug,
      Slug: exp.slug,
      "Last Run": exp.lastRunAt
        ? formatRelativeTime(exp.lastRunAt)
        : chalk.gray("—"),
      Runs: String(exp.runsCount),
    }));

    formatTable({
      data: tableData,
      headers: ["Name", "Slug", "Last Run", "Runs"],
      colorMap: {
        Name: chalk.cyan,
        Slug: chalk.green,
        Runs: chalk.yellow,
      },
    });

    if (result.pagination.hasMore) {
      console.log();
      console.log(
        chalk.gray(
          `Showing ${result.experiments.length} of ${result.pagination.totalHits}. Increase with --limit or use --format json for full data.`,
        ),
      );
    }

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch experiment list-runs --experiment <slug>")} to see runs for an experiment.`,
      ),
    );
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch experiments" });
    process.exit(1);
  }
};
