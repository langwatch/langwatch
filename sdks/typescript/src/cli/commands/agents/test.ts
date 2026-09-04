import chalk from "chalk";
import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Schedules one scripted scenario run against the agent and returns its ids:
 * the user sends "ping", the agent answers, and the run succeeds when the
 * answer arrives. The project gains no scenario, run plan or test suite.
 *
 * @see specs/agents/agent-test-run.feature
 */
export const testAgentCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new AgentsApiService();
  const spinner = createSpinner(`Scheduling a test run of agent "${id}"...`).start();

  try {
    const run = await service.test(id);
    spinner.succeed(`Test run scheduled: the agent is sent "ping"`);

    return {
      data: run,
      table: () => {
        console.log();
        console.log(chalk.bold("  Scenario run ID: ") + run.scenarioRunId);
        console.log(chalk.bold("  Batch run ID:    ") + run.batchRunId);
        console.log();
        console.log(
          chalk.dim(`  Follow it with: langwatch simulation-run get ${run.scenarioRunId}`),
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: `test agent "${id}"` });
    process.exit(1);
  }
};
