import chalk from "chalk";
import ora from "ora";
import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { deriveRunStatus } from "@/client-sdk/services/experiments/run-status";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { resolveRunId } from "./resolve-run";

const statusColor = (status: string) =>
  status === "completed"
    ? chalk.green
    : status === "failed" || status === "interrupted"
      ? chalk.red
      : status === "running"
        ? chalk.yellow
        : chalk.gray;

// SDK-logged runs (langwatch.experiment + evaluation.log) never populate the
// Redis run-state that GET /runs/:runId reads, so that endpoint 404s for them.
// Their data lives only in ClickHouse, reachable through the results endpoint,
// so we derive the status from there. experimentSlug is required because runId
// is not unique across experiments once the Redis run-state expires.
const statusFromResults = async ({
  service,
  runId,
  experimentSlug,
}: {
  service: ExperimentsApiService;
  runId: string;
  experimentSlug: string;
}): Promise<{
  runId: string;
  status: string;
  progress: number;
  total: number;
  startedAt?: number;
  finishedAt?: number;
  stoppedAt?: number;
} | null> => {
  try {
    const results = await service.getRunResults({ runId, experimentSlug });
    return {
      runId,
      status: deriveRunStatus(results.timestamps),
      progress: results.progress ?? results.dataset.length,
      total: results.total ?? results.dataset.length,
      startedAt: results.timestamps.createdAt,
      finishedAt: results.timestamps.finishedAt ?? undefined,
      stoppedAt: results.timestamps.stoppedAt ?? undefined,
    };
  } catch (error) {
    // Only a genuine "no such run" is a fallback miss. Real 5xx / auth /
    // network errors must propagate so they aren't masked as not-found.
    const message = error instanceof Error ? error.message : String(error);
    if (/404|not found/i.test(message)) {
      return null;
    }
    throw error;
  }
};

export const experimentStatusCommand = async (
  experimentSlug: string,
  options?: { format?: string; runId?: string },
): Promise<void> => {
  checkApiKey();

  const service = new ExperimentsApiService();
  const spinner = ora(`Checking status for "${experimentSlug}"...`).start();

  try {
    const runId = await resolveRunId({
      service,
      experimentSlug,
      runId: options?.runId,
    });

    let status: {
      runId?: string;
      status: string;
      progress: number;
      total: number;
      startedAt?: number;
      finishedAt?: number;
      stoppedAt?: number;
      summary?: {
        completedCells?: number;
        failedCells?: number;
        duration?: number;
        runUrl?: string;
      };
    };

    try {
      status = await service.getRunStatus(runId);
    } catch (error) {
      // Only a missing Redis run-state warrants the ClickHouse fallback. Real
      // 5xx / auth / network failures must propagate, otherwise a working
      // results call would mask them as a healthy derived status.
      const message = error instanceof Error ? error.message : String(error);
      if (!/404|not found/i.test(message)) {
        throw error;
      }

      const fallback = await statusFromResults({
        service,
        runId,
        experimentSlug,
      });
      if (!fallback) throw error;
      status = fallback;
    }

    const color = statusColor(status.status);
    spinner.succeed(`Run ${chalk.cyan(runId)}: ${color(status.status)}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("Status:")}   ${color(status.status)}`);
    console.log(`  ${chalk.gray("Progress:")} ${status.progress}/${status.total} cells`);

    if (status.startedAt) {
      console.log(`  ${chalk.gray("Started:")}  ${new Date(status.startedAt).toLocaleString()}`);
    }
    if (status.finishedAt) {
      console.log(`  ${chalk.gray("Finished:")} ${new Date(status.finishedAt).toLocaleString()}`);
    }
    if (status.stoppedAt) {
      console.log(`  ${chalk.gray("Stopped:")}  ${new Date(status.stoppedAt).toLocaleString()}`);
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
    failSpinner({ spinner, error, action: "check experiment status" });
    process.exit(1);
  }
};
