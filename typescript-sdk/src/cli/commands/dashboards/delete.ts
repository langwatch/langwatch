import chalk from "chalk";
import ora from "ora";
import {
  DashboardsApiService,
  DashboardsApiError,
} from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const deleteDashboardCommand = async (id: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new DashboardsApiService();
  const spinner = ora(`Deleting dashboard "${id}"...`).start();

  try {
    const result = await service.delete(id);
    spinner.succeed(`Deleted dashboard "${chalk.cyan(result.name)}" ${chalk.gray(`(id: ${result.id})`)}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    spinner.fail();
    if (error instanceof DashboardsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error deleting dashboard: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};
