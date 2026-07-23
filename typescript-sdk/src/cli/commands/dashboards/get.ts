import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the dashboard rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getDashboardCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new DashboardsApiService();
  const spinner = createSpinner(`Fetching dashboard "${id}"...`).start();

  try {
    const dashboard = await service.get(id);

    spinner.succeed(`Found dashboard "${dashboard.name}"`);

    return {
      data: dashboard,
      table: () => {
        console.log();
        console.log(chalk.bold("  Dashboard Details:"));
        console.log(`    ${chalk.gray("ID:")}      ${chalk.green(dashboard.id)}`);
        console.log(`    ${chalk.gray("Name:")}    ${chalk.cyan(dashboard.name)}`);
        console.log(`    ${chalk.gray("Graphs:")}  ${Array.isArray(dashboard.graphs) ? dashboard.graphs.length : 0}`);
        console.log(`    ${chalk.gray("Created:")} ${new Date(dashboard.createdAt).toLocaleString()}`);
        console.log(`    ${chalk.gray("Updated:")} ${new Date(dashboard.updatedAt).toLocaleString()}`);
        if (dashboard.platformUrl) {
          console.log(`    ${chalk.bold("View:")}   ${chalk.underline(dashboard.platformUrl)}`);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch dashboard" });
    process.exit(1);
  }
};
