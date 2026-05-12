import chalk from "chalk";
import ora from "ora";
import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    failSpinner({ spinner, error, action: "update dashboard" });
    process.exit(1);
  }
};
