import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the unplaced chart's identity rather than printing it: the output
 * port renders it in whatever format the caller asked for (utils/output.ts).
 * Idempotent, like the endpoint: unplacing a chart that is not placed
 * succeeds all the same.
 */
export const unplaceChartCommand = async (
  id: string,
  options?: { project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new ChartsApiService();
  const spinner = createSpinner(`Removing chart "${id}" from its dashboard...`).start();

  try {
    await service.unplace(id);

    spinner.succeed(`Chart "${chalk.cyan(id)}" is no longer on a dashboard`);

    return {
      data: { id: id, unplaced: true },
      table: () => {
        // The spinner line already says everything the human form carries.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "unplace chart" });
    process.exit(1);
  }
};
