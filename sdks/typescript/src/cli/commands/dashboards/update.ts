import chalk from "chalk";
import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the renamed dashboard rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const updateDashboardCommand = async (
  id: string,
  options: { name?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  if (!options.name) {
    console.error(chalk.red("Error: --name is required"));
    process.exit(1);
  }

  const service = new DashboardsApiService();
  const spinner = createSpinner(`Updating dashboard "${id}"...`).start();

  try {
    const dashboard = await service.rename(id, { name: options.name });

    spinner.succeed(`Dashboard renamed to "${dashboard.name}"`);

    return {
      data: dashboard,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(dashboard.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(dashboard.name)}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update dashboard" });
    process.exit(1);
  }
};
