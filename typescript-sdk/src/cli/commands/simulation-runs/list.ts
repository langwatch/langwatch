import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";

export const listSimulationRunsCommand = async (options: {
  scenarioSetId?: string;
  batchRunId?: string;
  limit?: string;
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora("Fetching simulation runs...").start();

  try {
    const params = new URLSearchParams();
    if (options.scenarioSetId) params.set("scenarioSetId", options.scenarioSetId);
    if (options.batchRunId) params.set("batchRunId", options.batchRunId);
    if (options.limit) params.set("limit", options.limit);

    const response = await fetch(
      `${endpoint}/api/simulation-runs?${params.toString()}`,
      {
        method: "GET",
        headers: { "X-Auth-Token": apiKey },
      },
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to fetch simulation runs: ${message}`);
      process.exit(1);
    }

    const result = await response.json() as {
      runs: Array<{
        scenarioRunId: string;
        scenarioId: string;
        batchRunId: string;
        name: string | null;
        status: string;
        durationInMs: number;
        totalCost?: number;
        results?: {
          verdict?: string | null;
        } | null;
      }>;
      hasMore?: boolean;
    };

    const runs = result.runs;
    spinner.succeed(`Found ${runs.length} simulation run${runs.length !== 1 ? "s" : ""}${result.hasMore ? " (more available)" : ""}`);

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (runs.length === 0) {
      console.log();
      console.log(chalk.gray("No simulation runs found."));
      console.log(chalk.gray("Run a suite to create simulation runs:"));
      console.log(chalk.cyan("  langwatch suite run <suiteId>"));
      return;
    }

    console.log();
    for (const run of runs) {
      const statusColor = run.status === "SUCCESS" ? chalk.green
        : run.status === "FAILED" ? chalk.red
        : run.status === "ERROR" ? chalk.red
        : run.status === "IN_PROGRESS" || run.status === "RUNNING" ? chalk.yellow
        : chalk.gray;

      const verdict = run.results?.verdict;
      const verdictStr = verdict ? ` (${verdict})` : "";
      const duration = run.durationInMs > 0 ? `${(run.durationInMs / 1000).toFixed(1)}s` : "—";
      const cost = run.totalCost ? `$${run.totalCost.toFixed(4)}` : "";

      console.log(`  ${statusColor("●")} ${chalk.cyan(run.name ?? run.scenarioId)} ${statusColor(run.status)}${verdictStr}`);
      console.log(`    ${chalk.gray("Run ID:")} ${run.scenarioRunId}  ${chalk.gray("Duration:")} ${duration}  ${cost ? chalk.gray("Cost:") + " " + cost : ""}`);
      console.log();
    }

    if (result.hasMore) {
      console.log(chalk.gray("  More runs available. Use --limit to fetch more."));
    }

    console.log(
      chalk.gray(`Use ${chalk.cyan("langwatch simulation-run get <runId>")} to view full details`),
    );
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch simulation runs" });
    process.exit(1);
  }
};
