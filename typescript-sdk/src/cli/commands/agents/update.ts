import chalk from "chalk";
import ora from "ora";
import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    if (error instanceof SyntaxError) {
      spinner.fail(chalk.red("--config must be valid JSON"));
    } else {
      failSpinner({ spinner, error, action: "update agent" });
    }
    process.exit(1);
  }
};
