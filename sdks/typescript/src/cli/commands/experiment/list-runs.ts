import chalk from "chalk";
import ora from "ora";
import {
  ExperimentsApiService,
  type ExperimentRunSummaryEntry,
} from "@/client-sdk/services/experiments/experiments-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { formatTable } from "../../utils/formatting";

export interface ListRunsOptions {
  experiment?: string;
  format?: string;
  limit?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_PAGE_SIZE = 200;

const formatTimestamp = (epochMs: number | null | undefined): string => {
  if (!epochMs || !Number.isFinite(epochMs)) return chalk.gray("—");
  return new Date(epochMs).toLocaleString();
};

const summarizePassRate = (
  evaluations: ExperimentRunSummaryEntry["summary"]["evaluations"],
): string => {
  const entries = Object.values(evaluations ?? {});
  if (entries.length === 0) return chalk.gray("—");
  const passEntries = entries.filter(
    (e) => typeof e.averagePassed === "number",
  );
  if (passEntries.length === 0) {
    const scoreEntries = entries.filter(
      (e) => typeof e.averageScore === "number",
    );
    if (scoreEntries.length === 0) return chalk.gray("—");
    const avg =
      scoreEntries.reduce((sum, e) => sum + (e.averageScore ?? 0), 0) /
      scoreEntries.length;
    return `${avg.toFixed(2)} avg`;
  }
  const avg =
    passEntries.reduce((sum, e) => sum + (e.averagePassed ?? 0), 0) /
    passEntries.length;
  return `${(avg * 100).toFixed(0)}% pass`;
};

const runStatus = (run: ExperimentRunSummaryEntry): string => {
  if (run.timestamps.stoppedAt) return chalk.gray("stopped");
  if (run.timestamps.finishedAt) return chalk.green("completed");
  return chalk.yellow("running");
};

export const experimentListRunsCommand = async (
  options: ListRunsOptions = {},
): Promise<void> => {
  checkApiKey();

  const experimentSlug = options.experiment?.trim();
  if (!experimentSlug) {
    console.error(
      chalk.red(
        "Error: --experiment <slug> is required. List experiments first with `langwatch experiment list`.",
      ),
    );
    process.exit(1);
  }

  const format = options.format === "json" ? "json" : "table";
  const limit = (() => {
    const parsed = options.limit ? parseInt(options.limit, 10) : DEFAULT_LIMIT;
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_PAGE_SIZE);
  })();

  const service = new ExperimentsApiService();
  const spinner = ora(
    `Fetching runs for "${experimentSlug}"...`,
  ).start();

  try {
    const result = await service.listRuns({
      experimentSlug,
      pageSize: limit,
    });

    spinner.succeed(
      `Found ${result.pagination.totalHits} run${result.pagination.totalHits === 1 ? "" : "s"} for ${chalk.cyan(experimentSlug)}`,
    );

    if (format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.runs.length === 0) {
      console.log();
      console.log(chalk.gray("No runs found for this experiment yet."));
      return;
    }

    console.log();

    const tableData = result.runs.map((run) => ({
      "Run ID": run.runId,
      Status: runStatus(run),
      Progress:
        typeof run.progress === "number" && typeof run.total === "number"
          ? `${run.progress}/${run.total}`
          : chalk.gray("—"),
      Started: formatTimestamp(run.timestamps.createdAt),
      Finished: formatTimestamp(run.timestamps.finishedAt),
      Result: summarizePassRate(run.summary?.evaluations ?? {}),
    }));

    formatTable({
      data: tableData,
      headers: ["Run ID", "Status", "Progress", "Started", "Finished", "Result"],
      colorMap: {
        "Run ID": chalk.cyan,
      },
    });

    if (result.pagination.hasMore) {
      console.log();
      console.log(
        chalk.gray(
          `Showing ${result.runs.length} of ${result.pagination.totalHits}. Increase with --limit or use --format json for full data.`,
        ),
      );
    }

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch experiment status <runId>")} or ${chalk.cyan("langwatch experiment results <runId>")} to drill into a run.`,
      ),
    );
  } catch (error) {
    failSpinner({ spinner, error, action: "list experiment runs" });
    process.exit(1);
  }
};
