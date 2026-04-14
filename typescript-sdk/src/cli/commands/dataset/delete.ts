import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

/**
 * Deletes (archives) a dataset by slug or ID.
 */
export const deleteCommand = async (slugOrId: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = createDatasetService();
  const spinner = ora(`Deleting dataset "${slugOrId}"...`).start();

  try {
    const dataset = await service.deleteDataset(slugOrId);

    spinner.succeed(
      `Dataset "${chalk.cyan(dataset.name)}" (${dataset.slug}) has been archived`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(dataset, null, 2));
    }
  } catch (error) {
    spinner.fail("Failed to delete dataset");
    handleDatasetCommandError(error, "deleting dataset");
  }
};
