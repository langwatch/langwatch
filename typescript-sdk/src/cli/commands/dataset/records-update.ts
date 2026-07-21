import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

/**
 * Updates a single record in a dataset.
 */
export const recordsUpdateCommand = async (
  slugOrId: string,
  recordId: string,
  options: { json: string },
): Promise<CommandResult | void> => {
  checkApiKey();

  let entry: Record<string, unknown>;
  try {
    const parsed = JSON.parse(options.json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object, not an array or primitive.");
    }
    entry = parsed as Record<string, unknown>;
  } catch (error) {
    reportCommandError({
      error: commandValidationError(
        error instanceof Error ? error.message : "Invalid JSON input",
      ),
    });
    process.exit(1);
  }

  const service = createDatasetService();
  const spinner = createSpinner(`Updating record "${recordId}" in "${slugOrId}"...`).start();

  try {
    const record = await service.updateRecord(slugOrId, recordId, entry);

    spinner.succeed(`Record updated: ${chalk.cyan(record.id)}`);

    return {
      data: record,
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    handleDatasetCommandError({ spinner, error, context: "update record" });
  }
};
