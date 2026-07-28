import { createSpinner } from "../../utils/spinner";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the archive result rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteSuiteCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = createSpinner(`Archiving suite "${id}"...`).start();

  try {
    const result = await service.delete(id);

    spinner.succeed(`Suite "${id}" archived`);

    return {
      data: result,
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete suite" });
    process.exit(1);
  }
};
