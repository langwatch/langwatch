import chalk from "chalk";
import ora from "ora";
import {
  DashboardsApiService,
  DashboardsApiError,
} from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const createDashboardCommand = async (name: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new DashboardsApiService();
  const spinner = ora(`Creating dashboard "${name}"...`).start();

  try {
    const dashboard = await service.create({ name });

    spinner.succeed(
      `Created dashboard "${chalk.cyan(dashboard.name)}" ${chalk.gray(`(id: ${dashboard.id})`)}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(dashboard, null, 2));
    }
  } catch (error) {
    spinner.fail();
    if (error instanceof DashboardsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error creating dashboard: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
