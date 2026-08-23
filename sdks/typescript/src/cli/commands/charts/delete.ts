import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the deleted chart's identity rather than printing it: the output
 * port renders it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteChartCommand = async (
  id: string,
  options?: { project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new ChartsApiService();
  const spinner = createSpinner(`Deleting chart "${id}"...`).start();

  try {
    const deleted = await service.delete(id);

    spinner.succeed(
      `Deleted chart "${chalk.cyan(deleted.name)}" ${chalk.gray(`(id: ${deleted.id})`)}`,
    );

    return {
      data: deleted,
      table: () => {
        // The spinner line already says everything the human form carries.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete chart" });
    process.exit(1);
  }
};
