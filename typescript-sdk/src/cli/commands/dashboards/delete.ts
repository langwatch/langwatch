import chalk from "chalk";
import ora from "ora";
import {
  DashboardsApiService,
  DashboardsApiError,
} from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const deleteDashboardCommand = async (id: string): Promise<void> => {
  checkApiKey();

  const service = new DashboardsApiService();
  const spinner = ora(`Deleting dashboard "${id}"...`).start();

  try {
    const result = await service.delete(id);
    spinner.succeed(`Deleted dashboard "${chalk.cyan(result.name)}" ${chalk.gray(`(id: ${result.id})`)}`);
  } catch (error) {
    spinner.fail();
    if (error instanceof DashboardsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error deleting dashboard: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
