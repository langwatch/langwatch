import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the created agent rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 */
export const createAgentCommand = async (
  name: string,
  options: { type: string; config?: string },
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new AgentsApiService();
  const spinner = createSpinner(`Creating agent "${name}"...`).start();

  try {
    const config = options.config
      ? (JSON.parse(options.config) as Record<string, unknown>)
      : {};

    const agent = await service.create({
      name,
      type: options.type,
      config,
    });

    spinner.succeed(
      `Created agent "${chalk.cyan(agent.name)}" ${chalk.gray(`(id: ${agent.id})`)}`,
    );

    return {
      data: agent,
      table: () => {
        if (agent.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(agent.platformUrl)}`);
        }
      },
    };
  } catch (error) {
    // Route BOTH failure kinds through failSpinner: a direct spinner.fail()
    // prints nothing in --json/--jq/agent mode (spinners are silent there).
    failSpinner({
      spinner,
      error:
        error instanceof SyntaxError
          ? commandValidationError("--config must be valid JSON")
          : error,
      action: "create agent",
    });
    process.exit(1);
  }
};
