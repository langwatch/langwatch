import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the updated agent rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 */
export const updateAgentCommand = async (
  id: string,
  options: { name?: string; type?: string; config?: string },
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new AgentsApiService();
  const spinner = createSpinner(`Updating agent "${id}"...`).start();

  try {
    const params: { name?: string; type?: string; config?: Record<string, unknown> } = {};
    if (options.name !== undefined) params.name = options.name;
    if (options.type !== undefined) params.type = options.type;
    if (options.config !== undefined) {
      params.config = JSON.parse(options.config) as Record<string, unknown>;
    }

    const agent = await service.update(id, params);

    spinner.succeed(
      `Updated agent "${chalk.cyan(agent.name)}" ${chalk.gray(`(id: ${agent.id})`)}`,
    );

    return {
      data: agent,
      table: () => {
        // The spinner's success line is the human output.
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
      action: "update agent",
    });
    process.exit(1);
  }
};
