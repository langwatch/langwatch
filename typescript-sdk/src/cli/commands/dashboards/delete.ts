import chalk from "chalk";
import ora from "ora";
import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    failSpinner({ spinner, error, action: "delete dashboard" });
    process.exit(1);
  }
};
