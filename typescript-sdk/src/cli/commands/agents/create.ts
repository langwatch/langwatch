import chalk from "chalk";
import ora from "ora";
import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const createAgentCommand = async (
  name: string,
  options: { type: string; config?: string; format?: string },
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

    if (options.format === "json") {
      console.log(JSON.stringify(agent, null, 2));
    } else if (agent.platformUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline(agent.platformUrl)}`);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      spinner.fail(chalk.red("--config must be valid JSON"));
    } else {
      failSpinner({ spinner, error, action: "create agent" });
    }
    process.exit(1);
  }
};
