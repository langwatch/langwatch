import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { resolveOutputFormat } from "../../utils/errorOutput";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
export const runSuiteCommand = async (
  id: string,
  options: { wait?: boolean; format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = createSpinner(`Scheduling suite run "${id}"...`).start();

  try {
    const result = await service.run(id);

    spinner.succeed(
      `Suite run scheduled: ${result.jobCount} job${result.jobCount !== 1 ? "s" : ""} (batch: ${result.batchRunId})`,
    );

    // JSON first: the skipped-archived details are already inside the document,
    // and prose printed before it would corrupt the parser's stdout.
    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.skippedArchived.scenarios.length > 0 || result.skippedArchived.targets.length > 0) {
      console.log();
      console.log(chalk.yellow("  Skipped archived references:"));
      if (result.skippedArchived.scenarios.length > 0) {
        console.log(chalk.yellow(`    Scenarios: ${result.skippedArchived.scenarios.join(", ")}`));
      }
      if (result.skippedArchived.targets.length > 0) {
        console.log(chalk.yellow(`    Targets: ${result.skippedArchived.targets.join(", ")}`));
      }
    }

    if (!options.wait) {
      console.log();
      console.log(`  ${chalk.gray("Batch Run ID:")} ${chalk.green(result.batchRunId)}`);
      console.log(`  ${chalk.gray("Jobs:")}         ${result.jobCount}`);
      console.log();
      console.log(
        chalk.gray(
          `View results in the LangWatch dashboard under Simulations.`,
        ),
      );
      console.log(
        chalk.gray(
          `Or re-run with ${chalk.cyan("--wait")} to poll for completion.`,
        ),
      );
      return;
    }

    // Nothing was scheduled — every scenario or target was archived, and the
    // skip notice above says which. No completion can ever arrive, so polling
    // would run out the full timeout and report a timeout for a run that is
    // already over.
    if (result.jobCount === 0) {
      console.log();
      console.log(chalk.yellow("  No jobs were scheduled — nothing to wait for."));
      return;
    }

    // Poll for completion
    console.log();
    const pollSpinner = createSpinner("Waiting for suite run to complete...").start();

    const apiKey = process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = resolveControlPlaneUrl();

    let completed = false;
    let lastStatus = "";
    const startTime = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    // A status endpoint that is down used to be indistinguishable from a suite
    // that is merely slow: every poll error was swallowed and the wait ran the
    // full ten minutes before reporting a timeout.
    const MAX_CONSECUTIVE_POLL_FAILURES = 5;
    let consecutivePollFailures = 0;

    while (!completed) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        failSpinner({
          spinner: pollSpinner,
          error: new Error("Suite run timed out after 10 minutes"),
          action: "run suite",
        });
        // Follow-up prose is human-only — in a machine format the structured
        // document above must keep stdout to itself.
        if (resolveOutputFormat() === "text") {
          console.log(
            chalk.yellow(
              `Check results in the dashboard. Batch ID: ${result.batchRunId}`,
            ),
          );
        }
        process.exit(1);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        // Poll the scenario events endpoint for batch status
        const statusResponse = await fetch(
          `${endpoint}/api/scenario-events?batchRunId=${encodeURIComponent(result.batchRunId)}`,
          {
            method: "GET",
            headers: buildAuthHeaders({ apiKey }),
          },
        );

        if (!statusResponse.ok) {
          throw new Error(`status endpoint answered ${statusResponse.status}`);
        }

        const statusData = await statusResponse.json() as {
          totalCount?: number;
          completedCount?: number;
          passedCount?: number;
          failedCount?: number;
          status?: string;
        };

        const total = statusData.totalCount ?? result.jobCount;
        const completedCount = statusData.completedCount ?? 0;
        const passed = statusData.passedCount ?? 0;
        const failed = statusData.failedCount ?? 0;

        const newStatus = `${completedCount}/${total} completed (${passed} passed, ${failed} failed)`;
        if (newStatus !== lastStatus) {
          pollSpinner.text = `Running... ${newStatus}`;
          lastStatus = newStatus;
        }

        if (completedCount >= total && total > 0) {
          completed = true;
          if (failed > 0) {
            pollSpinner.warn(
              `Suite run completed: ${passed}/${total} passed, ${chalk.red(`${failed} failed`)}`,
            );
            // The whole point of `--wait` is to find out whether the suite
            // passed. Reporting failures on stderr and still exiting 0 makes
            // that answer invisible to every machine caller — a CI step goes
            // green on a red suite, and an agent reads "success".
            process.exitCode = 1;
          } else {
            pollSpinner.succeed(
              `Suite run completed: ${chalk.green(`${passed}/${total} passed`)}`,
            );
          }
        }
      } catch {
        // Polling error — continue waiting. Bounded below, so a status endpoint
        // that is down ends the wait instead of spinning out the full timeout.
        consecutivePollFailures++;
        if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          pollSpinner.warn(
            `Stopped waiting: the run status endpoint failed ${consecutivePollFailures} times in a row. ` +
              `The suite is still running — check batch ${result.batchRunId}.`,
          );
          process.exitCode = 1;
          break;
        }
        continue;
      }
      consecutivePollFailures = 0;
    }

    console.log();
    console.log(`  ${chalk.gray("Batch Run ID:")} ${chalk.green(result.batchRunId)}`);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "run suite" });
    process.exit(1);
  }
};
