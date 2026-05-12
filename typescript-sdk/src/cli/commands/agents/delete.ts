import chalk from "chalk";
import ora from "ora";
import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    failSpinner({ spinner, error, action: "archive agent" });
    process.exit(1);
  }
};
