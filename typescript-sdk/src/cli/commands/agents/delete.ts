import chalk from "chalk";
import ora from "ora";
import {
  AgentsApiService,
  AgentsApiError,
} from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const deleteAgentCommand = async (id: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new AgentsApiService();
  const spinner = ora(`Archiving agent "${id}"...`).start();

  try {
    const result = await service.delete(id);
    spinner.succeed(
      `Archived agent "${chalk.cyan(result.name)}" ${chalk.gray(`(id: ${result.id})`)}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    spinner.fail();
    if (error instanceof AgentsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error archiving agent: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};
