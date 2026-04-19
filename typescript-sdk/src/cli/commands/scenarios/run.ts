import chalk from "chalk";
import ora from "ora";
import {
  SuitesApiService,
  type SuiteTarget,
} from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
  options: { target: string; wait?: boolean; format?: string },
): Promise<void> => {
  checkApiKey();

  if (!options.target) {
    console.error(chalk.red("Error: --target is required. Specify what to run the scenario against."));
    console.error(chalk.gray("  Example: langwatch scenario run <id> --target http:agent_abc123"));
    console.error(chalk.gray("  Target types: http, code, workflow, prompt"));
    process.exit(1);
  }

  const target = parseTarget(options.target);
  const suitesService = new SuitesApiService();

  // Create a temporary suite to execute this scenario
  const spinner = ora(`Preparing scenario run for "${id}"...`).start();

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

    const result = await suitesService.run(suite.id);

    spinner.succeed(
      `Scenario run scheduled: ${result.jobCount} job${result.jobCount !== 1 ? "s" : ""} (batch: ${result.batchRunId})`,
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
    const pollSpinner = ora("Waiting for scenario run to complete...").start();

    const apiKey = process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

    let completed = false;
    const startTime = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;

    while (!completed) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        pollSpinner.fail("Scenario run timed out after 10 minutes");
        console.log(
          chalk.yellow(`Check results in the dashboard. Batch ID: ${result.batchRunId}`),
        );
        await suitesService.delete(suite.id).catch(() => undefined);
        process.exit(1);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        const statusResponse = await fetch(
          `${endpoint}/api/scenario-events?batchRunId=${encodeURIComponent(result.batchRunId)}`,
          {
            method: "GET",
            headers: { "X-Auth-Token": apiKey },
          },
        );

        if (statusResponse.ok) {
          const statusData = await statusResponse.json() as {
            totalCount?: number;
            completedCount?: number;
            passedCount?: number;
            failedCount?: number;
          };

          const total = statusData.totalCount ?? result.jobCount;
          const completedCount = statusData.completedCount ?? 0;
          const passed = statusData.passedCount ?? 0;
          const failed = statusData.failedCount ?? 0;

          pollSpinner.text = `Running... ${completedCount}/${total} completed (${passed} passed, ${failed} failed)`;

          if (completedCount >= total && total > 0) {
            completed = true;
            if (failed > 0) {
              pollSpinner.warn(
                `Scenario run completed: ${passed}/${total} passed, ${chalk.red(`${failed} failed`)}`,
              );
            } else {
              pollSpinner.succeed(
                `Scenario run completed: ${chalk.green(`${passed}/${total} passed`)}`,
              );
            }
          }
        }
      } catch {
        // Polling error — continue waiting
      }
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
