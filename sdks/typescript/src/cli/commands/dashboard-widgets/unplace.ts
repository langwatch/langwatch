import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the unplaced widget's identity rather than printing it: the output
 * port renders it in whatever format the caller asked for (utils/output.ts).
 * Idempotent, like the endpoint: unplacing a widget that is not placed
 * succeeds all the same.
 */
export const unplaceDashboardWidgetCommand = async (
  id: string,
  options?: { project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const widgets = new DashboardWidgetsApiService();
  const spinner = createSpinner(`Removing widget "${id}" from its dashboard...`).start();

  try {
    await widgets.unplace(id);

    spinner.succeed(`Widget "${chalk.cyan(id)}" is no longer on a dashboard`);

    return {
      data: { id, unplaced: true },
      table: () => {
        // The spinner line already says everything the human form carries.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "unplace dashboard widget" });
    process.exit(1);
  }
};
