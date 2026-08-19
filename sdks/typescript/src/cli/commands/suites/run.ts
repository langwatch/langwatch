import { scopedApiKey } from "@/internal/credentialContext";
import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import {
  fetchBatchRuns,
  tallyBatchRuns,
  type BatchRun,
} from "../../utils/batchRunProgress";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import {
  printResult,
  resolveOutputOptions,
  type RawOutputFlags,
} from "../../utils/output";

/** How the run ended, in the final document a machine caller reads. */
type SuiteRunOutcome =
  | "scheduled"
  | "passed"
  | "failed"
  | "timeout"
  | "poll_failure";

interface SuiteRunTallies {
  total: number;
  completed: number;
  passed: number;
  failed: number;
}

/** The per-run rows of the final document, from the last successful poll. */
const toRunResults = (
  runs: BatchRun[],
): Array<{
  scenarioRunId: string | null;
  scenarioId: string | null;
  status: string | null;
  verdict: string | null;
}> =>
  runs.map((run) => ({
    scenarioRunId: run.scenarioRunId ?? null,
    scenarioId: run.scenarioId ?? null,
    status: run.status ?? null,
    verdict: run.results?.verdict ?? null,
  }));

export const runSuiteCommand = async ({
  id,
  options,
}: {
  id: string;
  options: { wait?: boolean; param?: string[] } & RawOutputFlags;
}): Promise<void> => {
  await resolveCredentials();

  const parameters = parseRunParameterFlags({ pairs: options.param });

  // Human prose prints live (warnings, spinner updates); a machine format
  // keeps stdout for the single final document `printResult` emits at the
  // end, whichever way the run ends.
  const machine = resolveOutputOptions(options).format !== "table";

  const service = new SuitesApiService();
  const spinner = createSpinner(`Scheduling suite run "${id}"...`).start();

  try {
    const result = await service.run(id, { parameters });

    spinner.succeed(
      `Suite run scheduled: ${result.jobCount} job${result.jobCount !== 1 ? "s" : ""} (batch: ${result.batchRunId})`,
    );

    if (
      !machine &&
      (result.skippedArchived.scenarios.length > 0 ||
        result.skippedArchived.targets.length > 0)
    ) {
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
      await printResult(
        { ...result, outcome: "scheduled" satisfies SuiteRunOutcome },
        {
          ...options,
          table: () => {
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
          },
        },
      );
      return;
    }

    // Nothing was scheduled: every scenario or target was archived, and the
    // skip notice above says which. No completion can ever arrive, so polling
    // would run out the full timeout and report a timeout for a run that is
    // already over.
    if (result.jobCount === 0) {
      await printResult(
        { ...result, outcome: "scheduled" satisfies SuiteRunOutcome },
        {
          ...options,
          table: () => {
            console.log();
            console.log(chalk.yellow("  No jobs were scheduled: nothing to wait for."));
          },
        },
      );
      return;
    }

    // Poll for completion
    if (!machine) console.log();
    const pollSpinner = createSpinner("Waiting for suite run to complete...").start();

    const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
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

    // The loop's exit paths all land on the single final document below, so
    // the outcome and tallies live outside it.
    let outcome: SuiteRunOutcome = "poll_failure";
    let tallies: SuiteRunTallies = {
      total: result.jobCount,
      completed: 0,
      passed: 0,
      failed: 0,
    };
    let latestRuns: BatchRun[] = [];

    while (!completed) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        outcome = "timeout";
        process.exitCode = 1;
        pollSpinner.fail(chalk.red("Suite run timed out after 10 minutes"));
        if (!machine) {
          console.log(
            chalk.yellow(
              `Check results in the dashboard. Batch ID: ${result.batchRunId}`,
            ),
          );
        }
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        latestRuns = await fetchBatchRuns({
          endpoint,
          batchRunId: result.batchRunId,
          headers: buildAuthHeaders({ apiKey }),
        });
        const progress = tallyBatchRuns(latestRuns);

        // The suite knows how many runs it dispatched; the endpoint only knows
        // how many exist so far. Take whichever is larger, or a batch whose
        // runs have not all been created yet reads as finished on the first
        // poll.
        const total = Math.max(progress.total, result.jobCount);
        tallies = {
          total,
          completed: progress.completed,
          passed: progress.passed,
          failed: progress.failed,
        };

        const newStatus = `${tallies.completed}/${total} completed (${tallies.passed} passed, ${tallies.failed} failed)`;
        if (newStatus !== lastStatus) {
          pollSpinner.text = `Running... ${newStatus}`;
          lastStatus = newStatus;
        }

        if (tallies.completed >= total && total > 0) {
          completed = true;
          if (tallies.failed > 0) {
            outcome = "failed";
            pollSpinner.warn(
              `Suite run completed: ${tallies.passed}/${total} passed, ${chalk.red(`${tallies.failed} failed`)}`,
            );
            // The whole point of `--wait` is to find out whether the suite
            // passed. Reporting failures on stderr and still exiting 0 makes
            // that answer invisible to every machine caller: a CI step goes
            // green on a red suite, and an agent reads "success".
            process.exitCode = 1;
          } else {
            outcome = "passed";
            pollSpinner.succeed(
              `Suite run completed: ${chalk.green(`${tallies.passed}/${total} passed`)}`,
            );
          }
        }
      } catch {
        // Polling error, continue waiting. Bounded below, so a status endpoint
        // that is down ends the wait instead of spinning out the full timeout.
        consecutivePollFailures++;
        if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          outcome = "poll_failure";
          pollSpinner.warn(
            `Stopped waiting: the run status endpoint failed ${consecutivePollFailures} times in a row. ` +
              `The suite is still running. Check batch ${result.batchRunId}.`,
          );
          process.exitCode = 1;
          break;
        }
        continue;
      }
      consecutivePollFailures = 0;
    }

    await printResult(
      {
        ...result,
        outcome,
        tallies,
        results: toRunResults(latestRuns),
      },
      {
        ...options,
        table: () => {
          console.log();
          console.log(`  ${chalk.gray("Batch Run ID:")} ${chalk.green(result.batchRunId)}`);
          console.log();
        },
      },
    );
  } catch (error) {
    failSpinner({ spinner, error, action: "run suite" });
    process.exit(1);
  }
};
