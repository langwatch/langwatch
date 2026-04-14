import chalk from "chalk";
import ora from "ora";
import {
  AgentsApiService,
  AgentsApiError,
} from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const updateAgentCommand = async (
  id: string,
  options: { name?: string; type?: string; config?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new AgentsApiService();
  const spinner = ora(`Updating agent "${id}"...`).start();

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

    if (options.format === "json") {
      console.log(JSON.stringify(agent, null, 2));
    }
  } catch (error) {
    spinner.fail();
    if (error instanceof SyntaxError) {
      console.error(chalk.red("Error: --config must be valid JSON"));
    } else if (error instanceof AgentsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error updating agent: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
