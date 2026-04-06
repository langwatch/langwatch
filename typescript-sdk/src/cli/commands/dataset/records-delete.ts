import chalk from "chalk";
import ora from "ora";
import {
  DatasetApiError,
  DatasetNotFoundError,
} from "@/client-sdk/services/datasets/errors";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";

/**
 * Deletes one or more records from a dataset by their IDs.
 */
export const recordsDeleteCommand = async (
  slugOrId: string,
  recordIds: string[],
): Promise<void> => {
  checkApiKey();

  if (recordIds.length === 0) {
    console.error(chalk.red("Error: At least one record ID is required."));
    process.exit(1);
  }

  const service = createDatasetService();
  const spinner = ora(
    `Deleting ${recordIds.length} record${recordIds.length !== 1 ? "s" : ""} from "${slugOrId}"...`,
  ).start();

  try {
    const result = await service.deleteRecords(slugOrId, recordIds);

    spinner.succeed(
      `Deleted ${result.deletedCount} record${result.deletedCount !== 1 ? "s" : ""} from "${chalk.cyan(slugOrId)}"`,
    );
  } catch (error) {
    spinner.fail("Failed to delete records");

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
