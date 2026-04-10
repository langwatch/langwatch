import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

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
    handleDatasetCommandError(error, "deleting records");
  }
};
