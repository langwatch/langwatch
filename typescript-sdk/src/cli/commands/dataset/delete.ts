import chalk from "chalk";
import ora from "ora";
import {
  DatasetApiError,
  DatasetNotFoundError,
} from "@/client-sdk/services/datasets/errors";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";

/**
 * Deletes (archives) a dataset by slug or ID.
 */
export const deleteCommand = async (slugOrId: string): Promise<void> => {
  checkApiKey();

  const service = createDatasetService();
  const spinner = ora(`Deleting dataset "${slugOrId}"...`).start();

  try {
    const dataset = await service.deleteDataset(slugOrId);

    spinner.succeed(
      `Dataset "${chalk.cyan(dataset.name)}" (${dataset.slug}) has been archived`,
    );
  } catch (error) {
    spinner.fail("Failed to delete dataset");

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
