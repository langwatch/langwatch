import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinnerFromResponse } from "../../utils/failFromResponse";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { triggerRequest } from "./triggerRequest";

/**
 * Returns the deletion result rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteTriggerCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const spinner = createSpinner(`Deleting trigger "${id}"...`).start();

  try {
    const response = await triggerRequest({
      path: `/${encodeURIComponent(id)}`,
      method: "DELETE",
    });

    if (!response.ok) {
      await failSpinnerFromResponse({ spinner, response, action: `delete trigger "${id}"` });
      process.exit(1);
    }

    const result: { id: string; deleted: boolean } = await response.json();
    spinner.succeed(`Trigger "${id}" deleted`);

    return {
      data: result,
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete trigger" });
    process.exit(1);
  }
};
