import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

/**
 * Deletes (archives) a dataset by slug or ID.
 */
export const deleteCommand = async (slugOrId: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = createDatasetService();
  const spinner = createSpinner(`Deleting dataset "${slugOrId}"...`).start();

  try {
    const dataset = await service.deleteDataset(slugOrId);

    spinner.succeed(
      `Dataset "${chalk.cyan(dataset.name ?? slugOrId)}" (${dataset.slug ?? slugOrId}) has been archived`,
    );

    return {
      data: dataset,
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    handleDatasetCommandError({ spinner, error, context: "delete dataset" });
  }
};
