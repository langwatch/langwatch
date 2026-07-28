import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the deletion outcome rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteDashboardCommand = async (id: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new DashboardsApiService();
  const spinner = createSpinner(`Deleting dashboard "${id}"...`).start();

  try {
    const result = await service.delete(id);
    spinner.succeed(`Deleted dashboard "${chalk.cyan(result.name)}" ${chalk.gray(`(id: ${result.id})`)}`);

    return {
      data: result,
      table: () => {
        // The spinner's success line is the human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete dashboard" });
    process.exit(1);
  }
};
