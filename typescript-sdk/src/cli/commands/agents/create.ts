import chalk from "chalk";
import ora from "ora";
import {
  AgentsApiService,
  AgentsApiError,
} from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const createAgentCommand = async (
  name: string,
  options: { type: string; config?: string },
): Promise<void> => {
  checkApiKey();

  const service = new AgentsApiService();
  const spinner = ora(`Creating agent "${name}"...`).start();

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
  } catch (error) {
    spinner.fail();
    if (error instanceof SyntaxError) {
      console.error(chalk.red("Error: --config must be valid JSON"));
    } else if (error instanceof AgentsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error creating agent: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
