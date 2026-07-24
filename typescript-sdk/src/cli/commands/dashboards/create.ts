import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the created dashboard rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const createDashboardCommand = async (name: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new DashboardsApiService();
  const spinner = createSpinner(`Creating dashboard "${name}"...`).start();

  try {
    const dashboard = await service.create({ name });

    spinner.succeed(
      `Created dashboard "${chalk.cyan(dashboard.name)}" ${chalk.gray(`(id: ${dashboard.id})`)}`,
    );

    return {
      data: dashboard,
      table: () => {
        if (dashboard.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(dashboard.platformUrl)}`);
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create dashboard" });
    process.exit(1);
  }
};
