import chalk from "chalk";
import ora from "ora";
import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    } else if (dashboard.platformUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline(dashboard.platformUrl)}`);
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "create dashboard" });
    process.exit(1);
  }
};
