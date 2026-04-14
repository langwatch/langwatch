import chalk from "chalk";
import ora from "ora";
import {
  DashboardsApiService,
  DashboardsApiError,
} from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const getDashboardCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new DashboardsApiService();
  const spinner = ora(`Fetching dashboard "${id}"...`).start();

  try {
    const dashboard = await service.get(id);

    spinner.succeed(`Found dashboard "${dashboard.name}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(dashboard, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold("  Dashboard Details:"));
    console.log(`    ${chalk.gray("ID:")}      ${chalk.green(dashboard.id)}`);
    console.log(`    ${chalk.gray("Name:")}    ${chalk.cyan(dashboard.name)}`);
    console.log(`    ${chalk.gray("Graphs:")}  ${Array.isArray(dashboard.graphs) ? dashboard.graphs.length : 0}`);
    console.log(`    ${chalk.gray("Created:")} ${new Date(dashboard.createdAt).toLocaleString()}`);
    console.log(`    ${chalk.gray("Updated:")} ${new Date(dashboard.updatedAt).toLocaleString()}`);
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
