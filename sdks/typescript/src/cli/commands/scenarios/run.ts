import { scopedApiKey } from "@/internal/credentialContext";
import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  SuitesApiService,
  type SuiteTarget,
} from "@/client-sdk/services/suites";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { resolveOutputFormat } from "../../utils/errorOutput";
import { buildAuthHeaders } from "@/internal/api/auth";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { fetchBatchRuns, tallyBatchRuns } from "../../utils/batchRunProgress";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import { parseRunNoteFlag } from "../../utils/runNote";

function parseTarget(targetStr: string): SuiteTarget {
  const colonIndex = targetStr.indexOf(":");
  if (colonIndex === -1) {
    console.error(chalk.red(`Error: Invalid target format "${targetStr}". Use <type>:<referenceId> (e.g., http:agent_abc123)`));
    process.exit(1);
  }
  const type = targetStr.slice(0, colonIndex);
  const referenceId = targetStr.slice(colonIndex + 1);
  if (!["prompt", "http", "code", "workflow"].includes(type)) {
    console.error(chalk.red(`Error: Invalid target type "${type}". Must be one of: prompt, http, code, workflow`));
    process.exit(1);
  }
  return { type: type as SuiteTarget["type"], referenceId };
}

export const runScenarioCommand = async (
  id: string,
  options: {
    target: string;
    wait?: boolean;
    format?: string;
    param?: string[];
    note?: string;
  },
): Promise<void> => {
  await resolveCredentials();

  const parameters = parseRunParameterFlags({ pairs: options.param });
  // The run goes through an ephemeral suite, so the note rides the same body
  // field a suite run uses and lands on every run of the batch.
  const note = parseRunNoteFlag({ note: options.note });

  if (!options.target) {
    console.error(chalk.red("Error: --target is required. Specify what to run the scenario against."));
    console.error(chalk.gray("  Example: langwatch scenario run <id> --target http:agent_abc123"));
    console.error(chalk.gray("  Target types: http, code, workflow, prompt"));
    process.exit(1);
  }

  const target = parseTarget(options.target);
  const suitesService = new SuitesApiService();

  // Create a temporary suite to execute this scenario
  const spinner = createSpinner(`Preparing scenario run for "${id}"...`).start();

  try {
    // Create an ephemeral suite for this single scenario run
    const suite = await suitesService.create({
      name: `CLI run: scenario ${id}`,
      description: `Ephemeral suite created by CLI for running scenario ${id}`,
      scenarioIds: [id],
      targets: [target],
      repeatCount: 1,
      labels: ["cli-ephemeral"],
    });

    spinner.text = `Running scenario against ${target.type}:${target.referenceId}...`;

    const result = await suitesService.run(suite.id, { parameters, note });

    spinner.succeed(
      `Scenario run scheduled: ${result.jobCount} job${result.jobCount !== 1 ? "s" : ""} (batch: ${result.batchRunId}${note ? `, note: "${note}"` : ""})`,
    );

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      await suitesService.delete(suite.id).catch(() => undefined);
      return;
    }

    if (!options.wait) {
      console.log();
      console.log(`  ${chalk.gray("Batch Run ID:")} ${chalk.green(result.batchRunId)}`);
      console.log(`  ${chalk.gray("Suite ID:")}     ${chalk.gray(suite.id)} ${chalk.gray("(ephemeral)")}`);
      if (note) {
        console.log(`  ${chalk.gray("Note:")}         ${note}`);
      }
      console.log();
      console.log(
        chalk.gray(`View results in the LangWatch dashboard under Simulations.`),
      );
      console.log(
        chalk.gray(`Or re-run with ${chalk.cyan("--wait")} to poll for completion.`),
      );

      await suitesService.delete(suite.id).catch(() => undefined);
      return;
    }

    // Poll for completion
    console.log();
    const pollSpinner = createSpinner("Waiting for scenario run to complete...").start();

    const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = resolveControlPlaneUrl();

    let completed = false;
    const startTime = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;
    const MAX_CONSECUTIVE_POLL_FAILURES = 5;
    let consecutivePollFailures = 0;

    while (!completed) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        failSpinner({
          spinner: pollSpinner,
          error: new Error("Scenario run timed out after 10 minutes"),
          action: "run scenario",
        });
        // Follow-up prose is human-only — in a machine format the structured
        // document above must keep stdout to itself.
        if (resolveOutputFormat() === "text") {
          console.log(
            chalk.yellow(`Check results in the dashboard. Batch ID: ${result.batchRunId}`),
          );
        }
        await suitesService.delete(suite.id).catch(() => undefined);
        process.exit(1);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        const progress = tallyBatchRuns(
          await fetchBatchRuns({
            endpoint,
            batchRunId: result.batchRunId,
            headers: buildAuthHeaders({ apiKey }),
          }),
        );

        // The run knows how many it dispatched; the endpoint only knows how
        // many exist so far. Take whichever is larger, or a batch whose runs
        // have not all been created yet reads as finished on the first poll.
        const total = Math.max(progress.total, result.jobCount);
        const { completed: completedCount, passed, failed } = progress;

        pollSpinner.text = `Running... ${completedCount}/${total} completed (${passed} passed, ${failed} failed)`;

        if (completedCount >= total && total > 0) {
          completed = true;
          if (failed > 0) {
            pollSpinner.warn(
              `Scenario run completed: ${passed}/${total} passed, ${chalk.red(`${failed} failed`)}`,
            );
            // `--wait` exists to report the verdict. Exiting 0 on a failed
            // run hides it from every machine caller — see suites/run.ts.
            process.exitCode = 1;
          }
          else {
            pollSpinner.succeed(
              `Scenario run completed: ${chalk.green(`${passed}/${total} passed`)}`,
            );
          }
        }
      } catch {
        // Polling error — continue waiting, but bounded: a status endpoint that
        // is down should not burn the whole timeout before saying so.
        consecutivePollFailures++;
        if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          pollSpinner.warn(
            `Stopped waiting: the run status endpoint failed ${consecutivePollFailures} times in a row. ` +
              `The scenario is still running — check batch ${result.batchRunId}.`,
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

    // Clean up ephemeral suite
    await suitesService.delete(suite.id).catch(() => undefined);
  } catch (error) {
    failSpinner({ spinner, error, action: "run scenario" });
    process.exit(1);
  }
};
