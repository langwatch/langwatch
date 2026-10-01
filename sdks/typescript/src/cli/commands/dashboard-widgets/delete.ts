import chalk from "chalk";

import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the deleted widget's identity rather than printing it (output port
 * renders per-format). The route answers `204` with no body, so the
 * confirmation carries the id the caller passed.
 */
export const deleteDashboardWidgetCommand = async (
  id: string,
  options?: { project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new DashboardWidgetsApiService();
  const spinner = createSpinner(`Deleting widget "${id}"...`).start();

  try {
    await service.delete(id);

    spinner.succeed(`Deleted widget "${chalk.cyan(id)}"`);

    return {
      data: { id: id, deleted: true },
      table: () => {
        // The spinner line already says everything the human form carries.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete dashboard widget" });
    process.exit(1);
  }
};
