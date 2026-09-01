import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { PlaygroundWidgetsApiService } from "@/client-sdk/services/playground-widgets/playground-widgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the deleted widget's identity rather than printing it: the output
 * port renders it in whatever format the caller asked for (utils/output.ts).
 * The route answers `204` with no body, so the confirmation carries the id
 * the caller passed — there is no response body to read a name from.
 */
export const deletePlaygroundWidgetCommand = async (
  id: string,
  options?: { project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new PlaygroundWidgetsApiService();
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
    failSpinner({ spinner, error, action: "delete playground widget" });
    process.exit(1);
  }
};
