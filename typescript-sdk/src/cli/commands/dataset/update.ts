import chalk from "chalk";
import ora from "ora";
import type { DatasetColumnType } from "@/client-sdk/services/datasets/types";
import {
  DatasetApiError,
  DatasetNotFoundError,
} from "@/client-sdk/services/datasets/errors";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";
import { parseColumns } from "./create";

/**
 * Updates an existing dataset's name and/or column types.
 */
export const updateCommand = async (
  slugOrId: string,
  options: { name?: string; columns?: string },
): Promise<void> => {
  checkApiKey();

  if (!options.name && !options.columns) {
    console.error(
      chalk.red("Error: At least one of --name or --columns must be provided."),
    );
    process.exit(1);
  }

  let columnTypes: DatasetColumnType[] | undefined;
  if (options.columns) {
    try {
      columnTypes = parseColumns(options.columns);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : "Invalid columns format"),
      );
      process.exit(1);
    }
  }

  const service = createDatasetService();
  const spinner = ora(`Updating dataset "${slugOrId}"...`).start();

  try {
    const dataset = await service.updateDataset(slugOrId, {
      name: options.name,
      columnTypes,
    });

    spinner.succeed(`Dataset updated: ${chalk.cyan(dataset.slug)}`);
    console.log();
    console.log(`  ${chalk.bold("Slug:")}  ${dataset.slug}`);
    console.log(`  ${chalk.bold("Name:")}  ${dataset.name}`);
    if (dataset.columnTypes.length > 0) {
      const colStr = dataset.columnTypes
        .map((c) => `${c.name}:${c.type}`)
        .join(", ");
      console.log(`  ${chalk.bold("Columns:")} ${colStr}`);
    }
  } catch (error) {
    spinner.fail("Failed to update dataset");

    if (error instanceof DatasetNotFoundError) {
      console.error(chalk.red(`Dataset not found: ${slugOrId}`));
    } else if (error instanceof DatasetApiError && error.status === 409) {
      console.error(
        chalk.red("A dataset with this name already exists. Choose a different name."),
      );
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
