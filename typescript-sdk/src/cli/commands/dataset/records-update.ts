import chalk from "chalk";
import ora from "ora";
import {
  DatasetApiError,
  DatasetNotFoundError,
} from "@/client-sdk/services/datasets/errors";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";

/**
 * Updates a single record in a dataset.
 */
export const recordsUpdateCommand = async (
  slugOrId: string,
  recordId: string,
  options: { json: string },
): Promise<void> => {
  checkApiKey();

  let entry: Record<string, unknown>;
  try {
    const parsed = JSON.parse(options.json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object, not an array or primitive.");
    }
    entry = parsed as Record<string, unknown>;
  } catch (error) {
    console.error(
      chalk.red(
        error instanceof Error ? error.message : "Invalid JSON input",
      ),
    );
    process.exit(1);
  }

  const service = createDatasetService();
  const spinner = ora(`Updating record "${recordId}" in "${slugOrId}"...`).start();

  try {
    const record = await service.updateRecord(slugOrId, recordId, entry);

    spinner.succeed(`Record updated: ${chalk.cyan(record.id)}`);
  } catch (error) {
    spinner.fail("Failed to update record");

    if (error instanceof DatasetNotFoundError) {
      console.error(chalk.red(`Dataset not found: ${slugOrId}`));
    } else if (error instanceof DatasetApiError) {
      console.error(chalk.red(`API Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
