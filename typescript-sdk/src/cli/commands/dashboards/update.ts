import chalk from "chalk";
import ora from "ora";
import {
  DashboardsApiService,
  DashboardsApiError,
} from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const updateDashboardCommand = async (
  id: string,
  options: { name?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  if (!options.name) {
    console.error(chalk.red("Error: --name is required"));
    process.exit(1);
  }

  const service = new DashboardsApiService();
  const spinner = ora(`Updating dashboard "${id}"...`).start();

  try {
    const dashboard = await service.rename(id, { name: options.name });

    spinner.succeed(`Dashboard renamed to "${dashboard.name}"`);

    if (options.format === "json") {
      console.log(JSON.stringify(dashboard, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}   ${chalk.green(dashboard.id)}`);
    console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(dashboard.name)}`);
    console.log();
  } catch (error) {
    spinner.fail();
    if (error instanceof DashboardsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
